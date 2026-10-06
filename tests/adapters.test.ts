import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CodexAdapter,
  claimCodexInputRequest,
  createCodexAdapter,
  dispatchCodexMessage,
  type CodexRpc,
} from "../src/adapters/codex.js";
import { mockAdapter } from "../src/adapters/mock.js";
import type {
  AgentAdapter,
  AdapterEvent,
  StepExecutionInput,
  StepSession,
} from "../src/adapters/contract.js";

type Notification = { id?: string | number; method?: string; params?: Record<string, unknown> };
class FixtureRpc implements CodexRpc {
  constructor(
    private readonly failFirst = false,
    private readonly recoveryActive = false,
    private readonly requestInput = false,
  ) {}
  calls: { method: string; params: Record<string, unknown> }[] = [];
  private listeners = new Set<(message: Notification) => void>();
  private nextThread = 0;
  notify(method: string, params: Record<string, unknown> = {}) {
    this.calls.push({ method, params });
  }
  subscribe(listener: (message: Notification) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(method: string, params: Record<string, unknown>, id?: string | number) {
    for (const listener of this.listeners)
      listener({ method, params, ...(id === undefined ? {} : { id }) });
  }
  replyToInput(id: string | number, answers: Record<string, { answers: string[] }>) {
    this.calls.push({ method: "replyToInput", params: { id, answers } });
    queueMicrotask(() =>
      this.emit("turn/completed", {
        threadId: "thread-1",
        turn: { id: "turn-thread-1", status: "completed" },
      }),
    );
  }
  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === "initialize") return { userAgent: "fixture" };
    if (method === "account/read")
      return { account: { type: "chatgpt" }, requiresOpenaiAuth: true };
    if (method === "model/list")
      return {
        data: [
          {
            model: "model-a",
            displayName: "Model A",
            hidden: false,
            supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }],
          },
          { model: "hidden", displayName: "Hidden", hidden: true },
        ],
      };
    if (method === "thread/start") return { thread: { id: `thread-${++this.nextThread}` } };
    if (method === "turn/start") {
      const threadId = String(params.threadId);
      const turnId = `turn-${threadId}`;
      if (this.requestInput) {
        queueMicrotask(() =>
          this.emit(
            "item/tool/requestUserInput",
            {
              threadId,
              turnId,
              itemId: "item-1",
              questions: [{ id: "choice", header: "Choice", question: "Choose", options: [] }],
              isBlocking: true,
              autoResolutionMs: null,
            },
            0,
          ),
        );
        return { turn: { id: turnId } };
      }
      queueMicrotask(() => {
        this.emit("item/agentMessage/delta", { threadId, turnId, delta: "progress" });
        this.emit("turn/completed", {
          threadId,
          turn: {
            id: turnId,
            status: this.failFirst && threadId === "thread-1" ? "failed" : "completed",
          },
        });
      });
      return { turn: { id: turnId } };
    }
    if (method === "thread/resume") return { thread: { id: params.threadId } };
    if (method === "thread/read") {
      if (this.recoveryActive)
        queueMicrotask(() => {
          this.emit("item/agentMessage/delta", {
            threadId: "thread-1",
            turnId: "turn-thread-1",
            delta: "resumed",
          });
          this.emit("turn/completed", {
            threadId: "thread-1",
            turn: { id: "turn-thread-1", status: "completed" },
          });
        });
      return {
        thread: {
          id: params.threadId,
          turns: [
            {
              id: "turn-thread-1",
              status: this.recoveryActive ? "inProgress" : "completed",
              items: [{ type: "agentMessage", text: "saved" }],
            },
          ],
        },
      };
    }
    if (method === "turn/steer") return {};
    throw new Error(`Unexpected method ${method}`);
  }
}

const input: StepExecutionInput = {
  runId: "run-1",
  stepId: "selected-step",
  attempt: 1,
  instruction: "Fixture only",
  projectDirectory: "/tmp/disposable-project",
  binding: { provider: "codex", model: "model-a" },
};
async function collect(adapter: AgentAdapter, step: StepExecutionInput): Promise<AdapterEvent[]> {
  const result: AdapterEvent[] = [];
  for await (const event of adapter.execute(step, new AbortController().signal)) result.push(event);
  return result;
}

describe("portable adapter conformance", () => {
  it("rejects a native input request when only another thread is listening", () => {
    const request = {
      id: 0,
      method: "item/tool/requestUserInput",
      params: { threadId: "ended-thread" },
    };
    const otherThread = (message: Parameters<typeof claimCodexInputRequest>[1]) =>
      message.params?.threadId === "active-thread";
    const replies: Record<string, unknown>[] = [];
    dispatchCodexMessage(request, {
      response: () => {},
      notification: () => {},
      userInputRequest: (message) => claimCodexInputRequest([otherThread], message),
      send: (reply) => replies.push(reply),
    });
    expect(replies).toMatchObject([
      { id: 0, error: { code: -32601, message: expect.stringContaining("requestUserInput") } },
    ]);
    expect(
      claimCodexInputRequest([otherThread], { ...request, params: { threadId: "active-thread" } }),
    ).toBe(true);
  });
  it("declines approval requests and rejects unsupported server requests without consuming response IDs", () => {
    const replies: Record<string, unknown>[] = [];
    const responses: Record<string, unknown>[] = [];
    const notifications: Record<string, unknown>[] = [];
    const handlers = {
      response: (message: Record<string, unknown>) => responses.push(message),
      notification: (message: Record<string, unknown>) => notifications.push(message),
      send: (message: Record<string, unknown>) => replies.push(message),
    };

    dispatchCodexMessage(
      { id: 7, method: "item/commandExecution/requestApproval", params: {} },
      handlers,
    );
    dispatchCodexMessage(
      { id: 8, method: "item/fileChange/requestApproval", params: {} },
      handlers,
    );
    dispatchCodexMessage({ id: 9, method: "unknown/serverRequest", params: {} }, handlers);
    dispatchCodexMessage({ id: 7, method: "item/commandExecution/requestApproval" }, handlers);

    expect(replies).toEqual([
      { jsonrpc: "2.0", id: 7, result: { decision: "decline" } },
      { jsonrpc: "2.0", id: 8, result: { decision: "decline" } },
      {
        jsonrpc: "2.0",
        id: 9,
        error: { code: -32601, message: "Unsupported Codex server request: unknown/serverRequest" },
      },
      { jsonrpc: "2.0", id: 7, result: { decision: "decline" } },
    ]);
    expect(responses).toEqual([]);
    expect(notifications).toEqual([]);
    dispatchCodexMessage({ id: 7, result: { ok: true } }, handlers);
    expect(responses).toEqual([{ id: 7, result: { ok: true } }]);
  });

  it("uses explicit file approval decisions, stays closed on errors, and never approves commands", () => {
    const replies: Record<string, unknown>[] = [];
    const handlers = {
      response: () => {},
      notification: () => {},
      send: (value: Record<string, unknown>) => replies.push(value),
      approveFileChange: () => true,
    };
    dispatchCodexMessage({ id: 1, method: "item/fileChange/requestApproval" }, handlers);
    dispatchCodexMessage({ id: 2, method: "item/commandExecution/requestApproval" }, handlers);
    dispatchCodexMessage(
      { id: 3, method: "item/fileChange/requestApproval" },
      {
        ...handlers,
        approveFileChange: () => {
          throw new Error("No decision");
        },
      },
    );
    expect(replies).toEqual([
      { jsonrpc: "2.0", id: 1, result: { decision: "accept" } },
      { jsonrpc: "2.0", id: 2, result: { decision: "decline" } },
      { jsonrpc: "2.0", id: 3, result: { decision: "decline" } },
    ]);
  });

  it("rejects a spoofed executable before opening the app-server", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factory-executable-"));
    try {
      const executable = join(directory, "codex");
      await writeFile(executable, "#!/bin/sh\necho other-cli 1.2.3\n");
      await chmod(executable, 0o755);
      await expect(createCodexAdapter(executable)).rejects.toThrow(/not a supported Codex CLI/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("inspects a provider without treating catalog entries as entitlement", async () => {
    const rpc = new FixtureRpc();
    const adapter = new CodexAdapter(rpc, "/bin/codex", "0.160.0");
    expect(await adapter.inspect(input.projectDirectory)).toMatchObject({
      authentication: "authenticated",
      authenticationMechanism: "Codex-owned ChatGPT login",
      protocol: "Codex app-server JSON-RPC over stdio",
      models: [{ id: "model-a", displayName: "Model A", efforts: ["low", "high"] }],
    });
    expect(rpc.calls.map((call) => call.method)).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "model/list",
    ]);
    expect(await mockAdapter.inspect(input.projectDirectory)).toMatchObject({
      authentication: "not-required",
      capabilities: {
        steering: "unsupported",
        resume: "unsupported",
        pause: "unsupported",
        waitingInput: "unsupported",
      },
    });
  });

  it("sends catalog-supported effort at turn start and leaves agent default model to Codex", async () => {
    const rpc = new FixtureRpc();
    await collect(new CodexAdapter(rpc, "/bin/codex", "0.160.0"), {
      ...input,
      binding: { provider: "codex", model: "agent-default", effort: "high" },
    });
    expect(rpc.calls.find((call) => call.method === "thread/start")?.params.model).toBeNull();
    expect(rpc.calls.find((call) => call.method === "turn/start")?.params.effort).toBe("high");
  });

  it("streams one assigned step with stable factory and native identities", async () => {
    const rpc = new FixtureRpc();
    const events = await collect(new CodexAdapter(rpc, "/bin/codex", "0.160.0"), input);
    expect(events.map((event) => event.type)).toEqual(["started", "message", "completed"]);
    expect(rpc.calls.find((call) => call.method === "turn/start")?.params.sandboxPolicy).toEqual({
      type: "workspaceWrite",
      writableRoots: [input.projectDirectory],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    });
    expect(
      events.every(
        (event) =>
          event.runId === "run-1" &&
          event.stepId === "selected-step" &&
          event.attempt === 1 &&
          event.sessionId === "thread-1" &&
          event.turnId === "turn-thread-1",
      ),
    ).toBe(true);
    expect(rpc.calls.find((call) => call.method === "thread/start")?.params).toMatchObject({
      cwd: input.projectDirectory,
      model: "model-a",
    });
    expect(rpc.calls.filter((call) => call.method === "turn/start")).toHaveLength(1);
  });

  it("correlates a blocking native input request and reply on its active turn", async () => {
    const rpc = new FixtureRpc(false, false, true);
    const adapter = new CodexAdapter(rpc, "/bin/codex", "0.160.0");
    const stream = adapter.execute(input, new AbortController().signal)[Symbol.asyncIterator]();
    expect((await stream.next()).value).toMatchObject({ type: "started", turnId: "turn-thread-1" });
    const request = (await stream.next()).value;
    expect(request).toMatchObject({
      type: "input-request",
      requestId: 0,
      itemId: "item-1",
      sessionId: "thread-1",
      turnId: "turn-thread-1",
    });
    if (!request || request.type !== "input-request") throw new Error("Missing input request");
    const answers = { choice: { answers: ["yes"] } };
    await adapter.replyToInput(request, request.requestId, answers);
    expect(rpc.calls.find((call) => call.method === "replyToInput")?.params).toEqual({
      id: 0,
      answers,
    });
    await expect(adapter.replyToInput(request, request.requestId, answers)).rejects.toThrow(
      /no longer pending/,
    );
    expect((await stream.next()).value).toMatchObject({ type: "completed", outcome: "succeeded" });
    expect((await stream.next()).done).toBe(true);
  });

  it("emits public tool output while excluding private reasoning notifications", async () => {
    class ToolRpc extends FixtureRpc {
      override emit(method: string, params: Record<string, unknown>) {
        if (method === "item/agentMessage/delta") {
          super.emit("item/started", {
            ...params,
            item: { type: "commandExecution", command: "pnpm check", status: "inProgress" },
          });
          super.emit("item/agentReasoning/delta", { ...params, delta: "private analysis" });
          super.emit("item/completed", {
            ...params,
            item: {
              type: "commandExecution",
              command: "pnpm check",
              status: "completed",
              aggregatedOutput: "tests passed",
            },
          });
        }
        super.emit(method, params);
      }
    }
    const events = await collect(new CodexAdapter(new ToolRpc(), "/bin/codex", "0.160.0"), input);
    expect(events.filter((event) => event.type === "tool")).toMatchObject([
      { title: "pnpm check", state: "running" },
      { title: "pnpm check", state: "completed", detail: "tests passed" },
    ]);
    expect(JSON.stringify(events)).not.toContain("private analysis");
  });

  it("retries only the selected failed step as a distinct attempt and session", async () => {
    const rpc = new FixtureRpc(true);
    const adapter = new CodexAdapter(rpc, "/bin/codex", "0.160.0");
    const first = await collect(adapter, input);
    const retry = await collect(adapter, { ...input, attempt: 2 });
    expect(first[0]?.sessionId).toBe("thread-1");
    expect(first.at(-1)).toMatchObject({ type: "completed", outcome: "failed" });
    expect(retry[0]).toMatchObject({ stepId: "selected-step", attempt: 2, sessionId: "thread-2" });
    expect(rpc.calls.filter((call) => call.method === "thread/start")).toHaveLength(2);
  });

  it("recovers a completed turn and steers the matching in-flight turn without interruption", async () => {
    const rpc = new FixtureRpc();
    const adapter = new CodexAdapter(rpc, "/bin/codex", "0.160.0");
    const session: StepSession = {
      runId: "run-1",
      stepId: "selected-step",
      attempt: 1,
      sessionId: "thread-1",
      turnId: "turn-thread-1",
    };
    const recovered = [];
    for await (const event of adapter.attach(session, new AbortController().signal))
      recovered.push(event);
    expect(recovered).toEqual([
      { type: "completed", outcome: "succeeded", output: "saved", ...session },
    ]);
    expect(await adapter.steer(session, "Focus on the selected check")).toBe("supported");
    expect(rpc.calls.find((call) => call.method === "turn/steer")?.params).toMatchObject({
      threadId: "thread-1",
      expectedTurnId: "turn-thread-1",
    });
    expect(rpc.calls.some((call) => call.method === "turn/interrupt")).toBe(false);
  });

  it("reattaches to an in-progress turn and streams its remaining native events", async () => {
    const rpc = new FixtureRpc(false, true);
    const adapter = new CodexAdapter(rpc, "/bin/codex", "0.160.0");
    const session: StepSession = {
      runId: "run-1",
      stepId: "selected-step",
      attempt: 1,
      sessionId: "thread-1",
      turnId: "turn-thread-1",
    };
    const events = [];
    for await (const event of adapter.attach(session, new AbortController().signal))
      events.push(event);
    expect(events.map((event) => event.type)).toEqual(["message", "completed"]);
    expect(events.at(-1)).toMatchObject({ output: "savedresumed", ...session });
  });

  it("keeps the mock on the same event contract and reports unsupported controls", async () => {
    const events = await collect(mockAdapter, {
      ...input,
      binding: { provider: "mock", model: "fixture" },
    });
    expect(events.map((event) => event.type)).toEqual(["started", "message", "completed"]);
    expect(events.every((event) => Boolean(event.sessionId && event.turnId))).toBe(true);
    expect(await mockAdapter.steer(events[0] as StepSession, "guide")).toBe("unsupported");
    await expect(async () => {
      for await (const _event of mockAdapter.attach(
        events[0] as StepSession,
        new AbortController().signal,
      )) {
        /* never */
      }
    }).rejects.toThrow(/unsupported/);
  });
});
