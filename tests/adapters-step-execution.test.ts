import { describe, expect, it } from "vitest";
import { CodexAdapter } from "../src/adapters/codex.js";
import { FixtureRpc, collect, input } from "./support/adapters.js";

describe("portable adapter conformance", () => {
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

  it("runs a read-only reviewer in Codex's read-only sandbox", async () => {
    const rpc = new FixtureRpc();
    await collect(new CodexAdapter(rpc, "/bin/codex", "0.160.0"), { ...input, readOnly: true });
    expect(rpc.calls.find((call) => call.method === "thread/start")?.params.sandbox).toBe(
      "read-only",
    );
    expect(rpc.calls.find((call) => call.method === "turn/start")?.params.sandboxPolicy).toEqual({
      type: "readOnly",
      networkAccess: false,
    });
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
});
