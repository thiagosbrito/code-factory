import { realpath } from "node:fs/promises";
import {
  CancellationUnconfirmedError,
  type AgentAdapter,
  type AgentCapabilities,
  type AgentConnection,
  type AdapterEvent,
  type StepExecutionInput,
  type StepSession,
} from "./contract.js";
import {
  type RpcMessage,
  inputRequestSchema,
  object,
  identifier,
  textInput,
  type CodexRpc,
} from "./codex-protocol.js";
import { type CodexThreadPolicy, decideCommandApproval } from "./codex-approval.js";

/** One assigned factory step is one Codex thread and turn. Retry creates a new thread. */
export class CodexAdapter implements AgentAdapter {
  readonly provider = "codex" as const;
  readonly capabilities: AgentCapabilities;
  private initialized?: Promise<void>;
  private readonly pendingInput = new Map<string, { requestId: string | number; itemId: string }>();
  // Policies live only in this process, so a thread resumed after a restart is declined.
  private readonly threadPolicies = new Map<string, CodexThreadPolicy>();

  approveCommandExecution(request: RpcMessage): boolean {
    const threadId = request.params?.threadId;
    return (
      decideCommandApproval(
        request.params,
        typeof threadId === "string" ? this.threadPolicies.get(threadId) : undefined,
      ) === "accept"
    );
  }

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

  /** Every page of `model/list`; a server that keeps returning cursors is cut off. */
  private async listModels(): Promise<unknown[]> {
    const entries: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const catalog = object(await this.rpc.request("model/list", cursor ? { cursor } : {}));
      if (Array.isArray(catalog.data)) entries.push(...catalog.data);
      if (typeof catalog.nextCursor !== "string" || !catalog.nextCursor) break;
      cursor = catalog.nextCursor;
    }
    return entries;
  }

  async inspect(_projectDirectory: string): Promise<AgentConnection> {
    await this.initialize();
    const account = object(await this.rpc.request("account/read", { refreshToken: false }));
    const accountType = account.account ? object(account.account).type : null;
    const entries = await this.listModels();
    const models = entries
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
      }));

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
    // An unresolvable directory keeps its literal path; approvals then fail closed on realpath.
    const root = await realpath(input.projectDirectory).catch(() => input.projectDirectory);
    const thread = object(
      object(
        await this.rpc.request("thread/start", {
          cwd: input.projectDirectory,
          model: input.binding.model === "agent-default" ? null : input.binding.model,
          approvalPolicy: "on-request",
          sandbox: input.readOnly ? "read-only" : "workspace-write",
        }),
      ).thread,
    );
    const sessionId = identifier(thread.id);
    this.threadPolicies.set(sessionId, {
      // A read-only reviewer never gets the grant, so every command approval request is declined.
      grant: !input.readOnly && input.toolGrant?.provider === "codex" ? input.toolGrant : null,
      root,
    });
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
            sandboxPolicy: input.readOnly
              ? { type: "readOnly", networkAccess: false }
              : {
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
      const cancellation = this.interruptOnAbort(session, signal);
      yield { type: "started", ...session };
      try {
        yield* feed.stream(session);
      } finally {
        await cancellation.close();
      }
    } finally {
      this.threadPolicies.delete(sessionId);
      feed.close();
    }
  }

  async *attach(session: StepSession, signal: AbortSignal): AsyncIterable<AdapterEvent> {
    signal.throwIfAborted();
    await this.initialize();
    const feed = this.events(session, signal);
    const cancellation = this.interruptOnAbort(session, signal);
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
      await cancellation.close();
      feed.close();
    }
  }

  private interruptOnAbort(session: StepSession, signal: AbortSignal): { close(): Promise<void> } {
    let interrupt: Promise<unknown> | undefined;
    const requestInterrupt = () => {
      interrupt ??= this.rpc.request("turn/interrupt", {
        threadId: session.sessionId,
        turnId: session.turnId,
      });
    };
    signal.addEventListener("abort", requestInterrupt, { once: true });
    return {
      close: async () => {
        signal.removeEventListener("abort", requestInterrupt);
        if (signal.aborted) requestInterrupt();
        try {
          await interrupt;
        } catch (error) {
          if (error instanceof Error && /no active turn to interrupt/i.test(error.message)) return;
          throw new CancellationUnconfirmedError(
            `Codex did not confirm turn interruption: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    };
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
