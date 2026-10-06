import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { z } from "zod";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentConnection,
  AdapterEvent,
  StepExecutionInput,
  StepSession,
} from "./contract.js";

const rpcMessageSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});
type RpcMessage = z.infer<typeof rpcMessageSchema>;
type RpcListener = (message: RpcMessage) => boolean | void;
const inputRequestSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  itemId: z.string().min(1),
  questions: z
    .array(
      z.object({
        id: z.string().min(1),
        header: z.string(),
        question: z.string().min(1),
        options: z.array(z.object({ label: z.string(), description: z.string() })).default([]),
      }),
    )
    .min(1),
  isBlocking: z.boolean(),
  autoResolutionMs: z.number().int().nonnegative().nullable(),
});
export const parseCodexMessage = (line: string): RpcMessage =>
  rpcMessageSchema.parse(JSON.parse(line));

export const claimCodexInputRequest = (
  listeners: Iterable<RpcListener>,
  request: RpcMessage,
): boolean => {
  let claimed = false;
  for (const listener of listeners) claimed = listener(request) === true || claimed;
  return claimed;
};

type RpcDispatch = {
  response(message: RpcMessage): void;
  notification(message: RpcMessage): void;
  userInputRequest?(message: RpcMessage): boolean;
  send(message: Record<string, unknown>): void;
  approveFileChange?(request: RpcMessage): boolean;
};

/** Route app-server messages, declining approvals and rejecting unknown requests by default. */
export const dispatchCodexMessage = (message: RpcMessage, handlers: RpcDispatch): void => {
  if (message.method && (typeof message.id === "number" || typeof message.id === "string")) {
    const approvalMethods = new Set([
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
    ]);
    if (approvalMethods.has(message.method)) {
      let decision = "decline";
      if (message.method === "item/fileChange/requestApproval") {
        try {
          if (handlers.approveFileChange?.(message) === true) decision = "accept";
        } catch {
          /* Keep the default denial. */
        }
      }
      handlers.send({ jsonrpc: "2.0", id: message.id, result: { decision } });
    } else if (
      message.method === "item/tool/requestUserInput" &&
      handlers.userInputRequest?.(message)
    ) {
      return;
    } else {
      handlers.send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Unsupported Codex server request: ${message.method}` },
      });
    }
    return;
  }
  if (message.method) handlers.notification(message);
  else if (typeof message.id === "number" || typeof message.id === "string")
    handlers.response(message);
};
export interface CodexRpc {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  notify(method: string, params?: Record<string, unknown>): void;
  subscribe(listener: RpcListener): () => void;
  replyToInput?(id: string | number, answers: Record<string, { answers: string[] }>): void;
  close?(): void;
}

/** A private stdio app-server process; credentials stay in Codex's own store. */
export class CodexStdioRpc implements CodexRpc {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private readonly listeners = new Set<RpcListener>();
  private nextId = 1;

  constructor(
    executable: string,
    options: { approveFileChange?(request: RpcMessage): boolean } = {},
  ) {
    this.child = spawn(executable, ["app-server", "--listen", "stdio://"], { stdio: "pipe" });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      let message: RpcMessage;
      try {
        message = parseCodexMessage(line);
      } catch {
        return;
      }
      dispatchCodexMessage(message, {
        response: (response) => {
          if (typeof response.id !== "number") return;
          const pending = this.pending.get(response.id);
          this.pending.delete(response.id);
          if (response.error)
            pending?.reject(new Error(response.error.message ?? "Codex RPC error"));
          else pending?.resolve(response.result);
        },
        notification: (notification) => {
          for (const listener of this.listeners) listener(notification);
        },
        userInputRequest: (request) => claimCodexInputRequest(this.listeners, request),
        send: (reply) => this.child.stdin.write(`${JSON.stringify(reply)}\n`),
        ...(options.approveFileChange ? { approveFileChange: options.approveFileChange } : {}),
      });
    });
    const fail = (error: Error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      for (const listener of this.listeners)
        listener({ method: "transport/closed", params: { message: error.message } });
    };
    this.child.on("error", fail);
    this.child.on("exit", (code) =>
      fail(new Error(`Codex app-server exited (${code ?? "signal"})`)),
    );
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  replyToInput(id: string | number, answers: Record<string, { answers: string[] }>): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result: { answers } })}\n`);
  }

  subscribe(listener: RpcListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.child.kill();
  }
}

/** Verify the executable before starting its native protocol process. */
export const createCodexAdapter = async (executable: string): Promise<CodexAdapter> => {
  const { stdout } = await promisify(execFile)(executable, ["--version"], { timeout: 5000 });
  const version = /^codex-cli (\d+\.\d+\.\d+)(?:\s|$)/.exec(stdout.trim())?.[1];
  if (!version) throw new Error("Executable is not a supported Codex CLI");
  return new CodexAdapter(new CodexStdioRpc(executable), executable, version);
};

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Codex response");
  return z.record(z.string(), z.unknown()).parse(value);
};
const identifier = (value: unknown): string => {
  if (typeof value !== "string" || !value) throw new Error("Missing Codex identity");
  return value;
};
const textInput = (text: string) => {
  return [{ type: "text", text, text_elements: [] }];
};

/** One assigned factory step is one Codex thread and turn. Retry creates a new thread. */
export class CodexAdapter implements AgentAdapter {
  readonly provider = "codex" as const;
  readonly capabilities: AgentCapabilities;
  private initialized?: Promise<void>;
  private readonly pendingInput = new Map<string, { requestId: string | number; itemId: string }>();

  constructor(
    private readonly rpc: CodexRpc,
    private readonly executable: string,
    private readonly version: string,
  ) {
    this.capabilities = {
      streaming: "unknown",
      steering: version === "0.160.0" ? "supported" : "unknown",
      resume: "unknown",
      pause: "unsupported",
      waitingInput: version === "0.160.0" ? "unsupported" : "unknown",
    };
  }

  close(): void {
    this.rpc.close?.();
  }

  private initialize(): Promise<void> {
    this.initialized ??= (async () => {
      await this.rpc.request("initialize", {
        clientInfo: { name: "code_factory", title: "Code Factory", version: "0.1.0" },
        capabilities: null,
      });
      this.rpc.notify("initialized");
    })();
    return this.initialized;
  }

  async inspect(_projectDirectory: string): Promise<AgentConnection> {
    await this.initialize();
    const account = object(await this.rpc.request("account/read", { refreshToken: false }));
    const accountType = account.account ? object(account.account).type : null;
    const catalog = object(await this.rpc.request("model/list", {}));
    const models = Array.isArray(catalog.data)
      ? catalog.data
          .map((entry) => object(entry))
          .filter((entry) => !entry.hidden)
          .map((entry) => ({
            id: identifier(entry.model),
            displayName: identifier(entry.displayName),
            efforts: Array.isArray(entry.supportedReasoningEfforts)
              ? entry.supportedReasoningEfforts
                  .map((effort) =>
                    effort && typeof effort === "object" && "reasoningEffort" in effort
                      ? effort.reasoningEffort
                      : null,
                  )
                  .filter((effort): effort is string => typeof effort === "string")
              : [],
          }))
      : [];
    return {
      provider: this.provider,
      executable: this.executable,
      version: this.version,
      identity: "Codex CLI",
      protocol: "Codex app-server JSON-RPC over stdio",
      installation: "detected",
      authentication: account.account ? "authenticated" : "unauthenticated",
      authenticationMechanism:
        accountType === "chatgpt"
          ? "Codex-owned ChatGPT login"
          : accountType === "apiKey"
            ? "Codex-owned API key"
            : accountType === "amazonBedrock"
              ? "Codex-owned Bedrock credentials"
              : "Codex-owned login required",
      capabilities: this.capabilities,
      models,
    };
  }

  async *execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent> {
    signal.throwIfAborted();
    await this.initialize();
    const thread = object(
      object(
        await this.rpc.request("thread/start", {
          cwd: input.projectDirectory,
          model: input.binding.model === "agent-default" ? null : input.binding.model,
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
        }),
      ).thread,
    );
    const sessionId = identifier(thread.id);
    const feed = this.events(
      { runId: input.runId, stepId: input.stepId, attempt: input.attempt, sessionId, turnId: "" },
      signal,
    );
    try {
      const turn = object(
        object(
          await this.rpc.request("turn/start", {
            threadId: sessionId,
            input: textInput(input.instruction),
            ...(input.binding.effort ? { effort: input.binding.effort } : {}),
            sandboxPolicy: {
              type: "workspaceWrite",
              writableRoots: [input.projectDirectory],
              networkAccess: false,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            },
          }),
        ).turn,
      );
      const session = {
        runId: input.runId,
        stepId: input.stepId,
        attempt: input.attempt,
        sessionId,
        turnId: identifier(turn.id),
      };
      yield { type: "started", ...session };
      yield* feed.stream(session);
    } finally {
      feed.close();
    }
  }

  async *attach(session: StepSession, signal: AbortSignal): AsyncIterable<AdapterEvent> {
    signal.throwIfAborted();
    await this.initialize();
    const feed = this.events(session, signal);
    try {
      await this.rpc.request("thread/resume", { threadId: session.sessionId, excludeTurns: true });
      const read = object(
        await this.rpc.request("thread/read", { threadId: session.sessionId, includeTurns: true }),
      );
      const thread = object(read.thread);
      const turns = Array.isArray(thread.turns) ? thread.turns.map(object) : [];
      const turn = turns.find((entry) => entry.id === session.turnId);
      if (!turn) throw new Error("Codex turn not found during recovery");
      if (turn.status !== "inProgress") {
        yield {
          type: "completed",
          ...session,
          outcome: turn.status === "completed" ? "succeeded" : "failed",
          output: this.turnOutput(turn),
        };
        return;
      }
      yield* feed.stream(session, this.turnOutput(turn));
    } finally {
      feed.close();
    }
  }

  async steer(
    session: StepSession,
    guidance: string,
  ): Promise<"supported" | "unsupported" | "unknown"> {
    if (!guidance.trim()) throw new Error("Guidance must not be empty");
    await this.initialize();
    await this.rpc.request("turn/steer", {
      threadId: session.sessionId,
      expectedTurnId: session.turnId,
      input: textInput(guidance),
    });
    return "supported";
  }

  async replyToInput(
    session: StepSession,
    requestId: string | number,
    answers: Record<string, { answers: string[] }>,
  ): Promise<void> {
    const key = `${session.sessionId}:${session.turnId}:${typeof requestId}:${requestId}`;
    if (!this.pendingInput.has(key) || !this.rpc.replyToInput)
      throw new Error("Native input request is no longer pending on this connection.");
    this.pendingInput.delete(key);
    this.rpc.replyToInput(requestId, answers);
  }

  private turnOutput(turn: Record<string, unknown>): string {
    const items = Array.isArray(turn.items) ? turn.items.map(object) : [];
    return items
      .filter((item) => item.type === "agentMessage")
      .map((item) => item.text)
      .filter((part): part is string => typeof part === "string")
      .join("\n");
  }

  private events(
    seed: StepSession,
    signal: AbortSignal,
  ): {
    stream(session: StepSession, initialOutput?: string): AsyncIterable<AdapterEvent>;
    close(): void;
  } {
    const queue: RpcMessage[] = [];
    const pendingInput = this.pendingInput;
    let wake: (() => void) | undefined;
    const unsubscribe = this.rpc.subscribe((message) => {
      if (message.method !== "transport/closed" && message.params?.threadId !== seed.sessionId)
        return false;
      if (
        message.method === "item/tool/requestUserInput" &&
        seed.turnId &&
        message.params?.turnId !== seed.turnId
      )
        return false;
      queue.push(message);
      wake?.();
      return message.method === "item/tool/requestUserInput";
    });
    // An async generator needs function syntax; arrows cannot yield.
    const stream = async function* (
      session: StepSession,
      initialOutput = "",
    ): AsyncIterable<AdapterEvent> {
      let output = initialOutput;
      try {
        while (true) {
          signal.throwIfAborted();
          if (!queue.length)
            await new Promise<void>((resolve) => {
              wake = resolve;
              signal.addEventListener("abort", () => resolve(), { once: true });
            });
          wake = undefined;
          signal.throwIfAborted();
          const message = queue.shift();
          if (!message || (message.params?.turnId && message.params.turnId !== session.turnId))
            continue;
          if (message.method === "item/tool/requestUserInput") {
            const request = inputRequestSchema.parse(message.params);
            if (message.id === undefined || !request.isBlocking)
              throw new Error("Invalid blocking Codex input request.");
            const key = `${session.sessionId}:${session.turnId}:${typeof message.id}:${message.id}`;
            pendingInput.set(key, { requestId: message.id, itemId: request.itemId });
            yield {
              type: "input-request",
              requestId: message.id,
              itemId: request.itemId,
              questions: request.questions,
              isBlocking: true,
              autoResolutionMs: request.autoResolutionMs,
              ...session,
            };
            continue;
          }
          if (message.method === "item/agentMessage/delta") {
            const delta = message.params?.delta;
            if (typeof delta === "string") {
              output += delta;
              yield { type: "message", text: delta, ...session };
            }
          }
          if (message.method === "item/started" || message.method === "item/completed") {
            const item = message.params?.item;
            if (message.method === "item/completed" && item && typeof item === "object") {
              const itemId = object(item).id;
              for (const [key, pending] of pendingInput)
                if (
                  key.startsWith(`${session.sessionId}:${session.turnId}:`) &&
                  pending.itemId === itemId
                )
                  pendingInput.delete(key);
            }
            if (
              item &&
              typeof item === "object" &&
              !Array.isArray(item) &&
              "type" in item &&
              (item.type === "commandExecution" || item.type === "fileChange")
            ) {
              const tool = object(item);
              const title =
                tool.type === "commandExecution"
                  ? typeof tool.command === "string"
                    ? tool.command
                    : "Command"
                  : "File change";
              const detail =
                tool.type === "commandExecution" && typeof tool.aggregatedOutput === "string"
                  ? tool.aggregatedOutput
                  : undefined;
              yield {
                type: "tool",
                title,
                ...(detail ? { detail } : {}),
                state:
                  message.method === "item/started"
                    ? "running"
                    : String(tool.status ?? "completed"),
                ...session,
              };
            }
          }
          if (message.method === "transport/closed" || message.method === "error")
            throw new Error(String(message.params?.message ?? "Codex stream error"));
          if (message.method === "turn/completed") {
            const turn = object(message.params?.turn);
            if (turn.id !== session.turnId) continue;
            yield {
              type: "completed",
              outcome: turn.status === "completed" ? "succeeded" : "failed",
              output,
              ...session,
            };
            return;
          }
        }
      } finally {
        for (const key of pendingInput.keys())
          if (key.startsWith(`${session.sessionId}:${session.turnId}:`)) pendingInput.delete(key);
        unsubscribe();
      }
    };
    return { stream, close: unsubscribe };
  }
}
