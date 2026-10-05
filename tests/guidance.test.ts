import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockAdapter } from "../src/adapters/mock.js";
import type { StepSession } from "../src/adapters/contract.js";
import { parseLoop } from "../src/domain/loop.js";
import {
  attachAttemptSession,
  createRunRecord,
  createRunSnapshot,
  finishAttempt,
  runRecordSchema,
  startAttempt,
} from "../src/domain/run.js";
import {
  acknowledgeGuidance,
  deliverQueuedGuidance,
  expireQueuedGuidance,
  sendGuidance,
} from "../src/runtime/guidance.js";
import { createRun, readRun, updateRun } from "../src/runtime/storage.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "factory-guidance-"));
  roots.push(root);
  const loop = parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 1,
    status: "published",
    steps: [{ id: "build", name: "Build", kind: "agent", role: "builder", instruction: "Build" }],
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
    policy: {},
  });
  let run = await createRun(
    root,
    createRunRecord(
      createRunSnapshot(loop, { description: "Task" }, { provider: "mock", model: "default" }),
    ),
  );
  run = startAttempt(run, "build");
  run = await updateRun(root, run);
  run = await updateRun(root, attachAttemptSession(run, "build", "thread-1", "turn-1"));
  run = await updateRun(
    root,
    runRecordSchema.parse({ ...run, status: "running", revision: run.revision + 1 }),
  );
  const attemptId = run.steps[0]?.attempts[0]?.id;
  if (!attemptId) throw new Error("Missing attempt");
  return {
    root,
    run,
    attemptId,
    input: { stepId: "build", attemptId, message: "Please check edge cases" },
  };
};
const steered = vi.fn<(_session: StepSession, _message: string) => Promise<"supported">>(
  async () => "supported",
);
const adapter = {
  ...mockAdapter,
  capabilities: {
    streaming: "supported" as const,
    steering: "supported" as const,
    resume: "unknown" as const,
  },
  steer: steered,
};
const states = (run: Awaited<ReturnType<typeof fixture>>["run"]) =>
  run.evidence.filter((item) => item.kind === "guidance").map((item) => item.state);

describe("cooperative guidance", () => {
  it("persists queued then delivered for the exact run, step, attempt and native turn", async () => {
    const { root, run, input } = await fixture();
    steered.mockClear();
    const queued = await sendGuidance(root, run.snapshot.id, input, null).catch(
      (error: unknown) => error,
    );
    expect(queued).toBeInstanceOf(Error);
    expect(states((await readRun(root, run.snapshot.id))!)).toEqual([]);
    const delivered = await sendGuidance(root, run.snapshot.id, input, adapter);
    expect(states(delivered)).toEqual(["queued", "delivered"]);
    expect(steered).toHaveBeenCalledOnce();
    expect(steered.mock.calls[0]?.[0]).toMatchObject({
      runId: run.snapshot.id,
      stepId: "build",
      attempt: 1,
      sessionId: "thread-1",
      turnId: "turn-1",
    });
    expect(steered.mock.calls[0]?.[1]).toContain("GUIDANCE-ACK:");
  });

  it("holds guidance while execution is waiting and delivers it after resume", async () => {
    const { root, run, input } = await fixture();
    const waiting = await updateRun(
      root,
      runRecordSchema.parse({ ...run, status: "waiting", revision: run.revision + 1 }),
    );
    steered.mockClear();
    const queued = await sendGuidance(root, waiting.snapshot.id, input, adapter);
    expect(states(queued)).toEqual(["queued"]);
    expect(steered).not.toHaveBeenCalled();
    const resumed = await updateRun(
      root,
      runRecordSchema.parse({ ...queued, status: "running", revision: queued.revision + 1 }),
    );
    const delivered = await deliverQueuedGuidance(root, resumed, "build", input.attemptId, adapter);
    expect(states(delivered)).toEqual(["queued", "delivered"]);
  });

  it("does not issue duplicate native steering for concurrent delivery checks", async () => {
    const { root, run, input } = await fixture();
    const waiting = await updateRun(
      root,
      runRecordSchema.parse({ ...run, status: "waiting", revision: run.revision + 1 }),
    );
    const queued = await sendGuidance(root, waiting.snapshot.id, input, adapter);
    const resumed = await updateRun(
      root,
      runRecordSchema.parse({ ...queued, status: "running", revision: queued.revision + 1 }),
    );
    steered.mockClear();
    await Promise.all([
      deliverQueuedGuidance(root, resumed, "build", input.attemptId, adapter),
      deliverQueuedGuidance(root, resumed, "build", input.attemptId, adapter),
    ]);
    expect(steered).toHaveBeenCalledOnce();
    expect(states((await readRun(root, run.snapshot.id))!)).toEqual(["queued", "delivered"]);
  });

  it("retains undelivered guidance and a reason for completed targets", async () => {
    const { root, run, input } = await fixture();
    const queued = await sendGuidance(root, run.snapshot.id, input, {
      ...adapter,
      steer: async () => "unknown",
    });
    expect(states(queued)).toEqual(["queued", "rejected"]);
    const finished = finishAttempt(queued, "build", "succeeded");
    const saved = await updateRun(root, finished);
    const stale = await sendGuidance(root, run.snapshot.id, input, adapter);
    expect(states(stale)).toEqual(["queued", "rejected", "rejected"]);
    expect(stale.evidence.at(-1)).toMatchObject({
      kind: "guidance",
      reason: expect.stringContaining("not delivered"),
    });
    expect(expireQueuedGuidance(saved, "build", input.attemptId)).toEqual(saved);
  });

  it("expires queued guidance when its attempt completes before delivery", async () => {
    const { root, run, input } = await fixture();
    const waiting = await updateRun(
      root,
      runRecordSchema.parse({ ...run, status: "waiting", revision: run.revision + 1 }),
    );
    const queued = await sendGuidance(root, waiting.snapshot.id, input, adapter);
    const ended = finishAttempt(queued, "build", "succeeded");
    const expired = expireQueuedGuidance(ended, "build", input.attemptId);
    expect(states(expired)).toEqual(["queued", "rejected"]);
    expect(expired.evidence.at(-1)).toMatchObject({
      reason: expect.stringContaining("before delivery"),
    });
  });

  it("acknowledges only a correlated agent reply after delivery", async () => {
    const { root, run, input } = await fixture();
    const delivered = await sendGuidance(root, run.snapshot.id, input, adapter);
    const receipt = delivered.evidence.find(
      (item) => item.kind === "guidance" && item.state === "delivered",
    );
    if (!receipt || receipt.kind !== "guidance") throw new Error("Missing delivery");
    const event = (detail: string, sequence: number) => ({
      id: crypto.randomUUID(),
      kind: "event" as const,
      runId: run.snapshot.id,
      stepId: "build",
      attemptId: input.attemptId,
      createdAt: new Date().toISOString(),
      type: "message" as const,
      title: "Agent message",
      detail,
      sequence,
    });
    const silent = event("Working", 0);
    const noAck = runRecordSchema.parse({
      ...delivered,
      revision: delivered.revision + 1,
      evidence: [...delivered.evidence, silent],
    });
    expect(states(acknowledgeGuidance(noAck, "build", input.attemptId, silent.id))).toEqual([
      "queued",
      "delivered",
    ]);
    const reply = event(`Done GUIDANCE-ACK:${receipt.messageId}`, 1);
    const withReply = runRecordSchema.parse({
      ...noAck,
      revision: noAck.revision + 1,
      evidence: [...noAck.evidence, reply],
    });
    expect(states(acknowledgeGuidance(withReply, "build", input.attemptId, reply.id))).toEqual([
      "queued",
      "delivered",
      "acknowledged",
    ]);
  });

  it("correlates a reply that arrives while the native steer call is in flight", async () => {
    const { root, run, input } = await fixture();
    const fastAdapter = {
      ...adapter,
      steer: async (_session: StepSession, guidance: string) => {
        const queued = await readRun(root, run.snapshot.id);
        if (!queued) throw new Error("Missing queued guidance");
        const token = guidance.match(/GUIDANCE-ACK:[0-9a-f-]+/)?.[0];
        const reply = {
          id: crypto.randomUUID(),
          kind: "event" as const,
          runId: run.snapshot.id,
          stepId: "build",
          attemptId: input.attemptId,
          createdAt: new Date().toISOString(),
          type: "message" as const,
          title: "Agent message",
          detail: `Done ${token}`,
          sequence: 0,
        };
        await updateRun(
          root,
          runRecordSchema.parse({
            ...queued,
            revision: queued.revision + 1,
            evidence: [...queued.evidence, reply],
          }),
        );
        return "supported" as const;
      },
    };
    const result = await sendGuidance(root, run.snapshot.id, input, fastAdapter);
    expect(states(result)).toEqual(["queued", "delivered", "acknowledged"]);
  });

  it("rejects unknown steering and a mismatched attempt without changing history", async () => {
    const { root, run, input } = await fixture();
    await expect(sendGuidance(root, run.snapshot.id, input, mockAdapter)).rejects.toThrow(
      /Steering is unsupported/,
    );
    await expect(
      sendGuidance(root, run.snapshot.id, { ...input, attemptId: crypto.randomUUID() }, adapter),
    ).rejects.toThrow(/does not belong/);
    expect(states((await readRun(root, run.snapshot.id))!)).toEqual([]);
  });
});
