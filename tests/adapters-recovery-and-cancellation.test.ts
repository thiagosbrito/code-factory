import { describe, expect, it } from "vitest";
import { CodexAdapter } from "../src/adapters/codex.js";
import { mockAdapter } from "../src/adapters/mock.js";
import { type StepSession } from "../src/adapters/contract.js";
import { FixtureRpc, collect, input } from "./support/adapters.js";

describe("portable adapter conformance", () => {
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

  it("interrupts the exact native turn before an aborted execution stream closes", async () => {
    const rpc = new FixtureRpc(false, false, true);
    const adapter = new CodexAdapter(rpc, "/bin/codex", "0.160.0");
    const controller = new AbortController();
    const iterator = adapter.execute(input, controller.signal)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "started" } });
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "input-request" } });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(rpc.calls.filter((call) => call.method === "turn/interrupt")).toEqual([
      {
        method: "turn/interrupt",
        params: { threadId: "thread-1", turnId: "turn-thread-1" },
      },
    ]);
  });

  it("interrupts a turn whose cancel arrived while turn/start was still pending", async () => {
    const controller = new AbortController();
    // Cancel lands during the turn/start round trip, before the adapter knows the turn's ID.
    class CancelDuringStart extends FixtureRpc {
      override async request(method: string, params: Record<string, unknown>) {
        const result = await super.request(method, params);
        if (method === "turn/start") controller.abort();
        return result;
      }
    }
    const rpc = new CancelDuringStart(false, false, true);
    const adapter = new CodexAdapter(rpc, "/bin/codex", "0.160.0");
    const iterator = adapter.execute(input, controller.signal)[Symbol.asyncIterator]();
    await iterator.next().catch(() => undefined);
    await iterator.next().catch(() => undefined);
    expect(rpc.calls.filter((call) => call.method === "turn/interrupt")).toEqual([
      {
        method: "turn/interrupt",
        params: { threadId: "thread-1", turnId: "turn-thread-1" },
      },
    ]);
  });

  it("does not confirm cancellation when the native interrupt fails", async () => {
    const rpc = new FixtureRpc(false, false, true, "transport closed");
    const adapter = new CodexAdapter(rpc, "/bin/codex", "0.160.0");
    const controller = new AbortController();
    const iterator = adapter.execute(input, controller.signal)[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    controller.abort();
    await expect(iterator.next()).rejects.toThrow(/did not confirm turn interruption/);
  });

  it("accepts an already-finished native turn as safely stopped", async () => {
    const rpc = new FixtureRpc(false, false, true, "no active turn to interrupt");
    const adapter = new CodexAdapter(rpc, "/bin/codex", "0.160.0");
    const controller = new AbortController();
    const iterator = adapter.execute(input, controller.signal)[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
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
