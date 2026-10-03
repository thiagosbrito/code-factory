import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type {
  AgentAdapter,
  AgentConnection,
  AdapterEvent,
  StepExecutionInput,
  StepSession,
} from "./contract.js";

type RpcMessage = {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
};

type RpcDispatch = {
  response(message: RpcMessage): void;
  notification(message: RpcMessage): void;
  send(message: Record<string, unknown>): void;
  approveFileChange?(request: RpcMessage): boolean;
};

/** Route app-server messages, declining approvals and rejecting unknown requests by default. */
export function dispatchCodexMessage(message: RpcMessage, handlers: RpcDispatch): void {
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
}
export interface CodexRpc {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  notify(method: string, params?: Record<string, unknown>): void;
  subscribe(listener: (message: RpcMessage) => void): () => void;
  close?(): void;
}

/** A private stdio app-server process; credentials stay in Codex's own store. */
export class CodexStdioRpc implements CodexRpc {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private readonly listeners = new Set<(message: RpcMessage) => void>();
  private nextId = 1;

  constructor(
    executable: string,
    options: { approveFileChange?(request: RpcMessage): boolean } = {},
  ) {
    this.child = spawn(executable, ["app-server", "--listen", "stdio://"], { stdio: "pipe" });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      let message: RpcMessage;
      try {
        message = JSON.parse(line) as RpcMessage;
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

  subscribe(listener: (message: RpcMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.child.kill();
  }
}

/** Verify the executable before starting its native protocol process. */
export async function createCodexAdapter(executable: string): Promise<CodexAdapter> {
  const { stdout } = await promisify(execFile)(executable, ["--version"], { timeout: 5000 });
  const version = /^codex-cli (\d+\.\d+\.\d+)(?:\s|$)/.exec(stdout.trim())?.[1];
  if (!version) throw new Error("Executable is not a supported Codex CLI");
  return new CodexAdapter(new CodexStdioRpc(executable), executable, version);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("Invalid Codex response");
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Missing Codex identity");
  return value;
}
function textInput(text: string) {
  return [{ type: "text", text, text_elements: [] }];
}

/** One assigned factory step is one Codex thread and turn. Retry creates a new thread. */
export class CodexAdapter implements AgentAdapter {
  readonly provider = "codex" as const;
  readonly capabilities = {
    streaming: "unknown",
    steering: "unknown",
    resume: "unknown",
  } as const;
  private initialized?: Promise<void>;

  constructor(
    private readonly rpc: CodexRpc,
    private readonly executable: string,
    private readonly version: string,
  ) {}

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
          }))
      : [];
    return {
      provider: this.provider,
      executable: this.executable,
      version: this.version,
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
          model: input.binding.model ?? null,
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
      yield* feed.stream(session);
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
  ): { stream(session: StepSession): AsyncIterable<AdapterEvent>; close(): void } {
    const queue: RpcMessage[] = [];
    let wake: (() => void) | undefined;
    const unsubscribe = this.rpc.subscribe((message) => {
      if (message.method !== "transport/closed" && message.params?.threadId !== seed.sessionId)
        return;
      queue.push(message);
      wake?.();
    });
    const stream = async function* (session: StepSession): AsyncIterable<AdapterEvent> {
      let output = "";
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
          if (message.method === "item/agentMessage/delta") {
            const delta = message.params?.delta;
            if (typeof delta === "string") {
              output += delta;
              yield { type: "message", text: delta, ...session };
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
        unsubscribe();
      }
    };
    return { stream, close: unsubscribe };
  }
}
