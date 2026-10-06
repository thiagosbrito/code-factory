import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockAdapter } from "../src/adapters/mock.js";
import { parseLoop } from "../src/domain/loop.js";
import {
  attachAttemptSession,
  createRunRecord,
  createRunSnapshot,
  runRecordSchema,
  setAttemptControlState,
  startAttempt,
} from "../src/domain/run.js";
import { replyToInput } from "../src/runtime/input.js";
import { sendGuidance } from "../src/runtime/guidance.js";
import { createRun, readRun, updateRun } from "../src/runtime/storage.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "factory-input-"));
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
  run = await updateRun(root, startAttempt(run, "build"));
  run = await updateRun(root, attachAttemptSession(run, "build", "thread-1", "turn-1"));
  const attemptId = run.steps[0]?.attempts[0]?.id;
  if (!attemptId) throw new Error("Missing attempt");
  run = await updateRun(root, setAttemptControlState(run, "build", attemptId, "waiting-input"));
  const requestEvidenceId = crypto.randomUUID();
  run = await updateRun(
    root,
    runRecordSchema.parse({
      ...run,
      status: "waiting-input",
      revision: run.revision + 1,
      evidence: [
        ...run.evidence,
        {
          id: requestEvidenceId,
          runId: run.snapshot.id,
          createdAt: new Date().toISOString(),
          kind: "input-request",
          stepId: "build",
          attemptId,
          sessionId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          requestId: 11,
          questions: [{ id: "answer", header: "Answer", question: "Choose", options: [] }],
          isBlocking: true,
          autoResolutionMs: null,
        },
      ],
    }),
  );
  return {
    root,
    run,
    input: {
      stepId: "build",
      attemptId,
      requestEvidenceId,
      answers: { answer: { answers: ["yes"] } },
    },
  };
};

it("correlates a native reply, persists it, rejects reuse and holds ordinary guidance", async () => {
  const { root, run, input } = await fixture();
  const steer = vi.fn<() => Promise<"supported">>(async () => "supported" as const);
  const nativeReply = vi.fn<() => Promise<void>>(async () => undefined);
  const adapter = {
    ...mockAdapter,
    capabilities: {
      ...mockAdapter.capabilities,
      steering: "supported" as const,
      waitingInput: "supported" as const,
    },
    steer,
    replyToInput: nativeReply,
  };
  const queued = await sendGuidance(
    root,
    run.snapshot.id,
    { stepId: "build", attemptId: input.attemptId, message: "Check this" },
    adapter,
  );
  expect(
    queued.evidence.filter((item) => item.kind === "guidance").map((item) => item.state),
  ).toEqual(["queued"]);
  expect(steer).not.toHaveBeenCalled();
  const replied = await replyToInput(root, run.snapshot.id, input, adapter);
  expect(nativeReply).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: "thread-1", turnId: "turn-1" }),
    11,
    input.answers,
  );
  expect(steer).toHaveBeenCalledOnce();
  expect(replied.evidence.filter((item) => item.kind === "input-reply")).toMatchObject([
    { requestEvidenceId: input.requestEvidenceId, state: "sent" },
  ]);
  await expect(replyToInput(root, run.snapshot.id, input, adapter)).rejects.toThrow(
    /no longer pending/,
  );
  expect((await readRun(root, run.snapshot.id))?.steps[0]?.attempts[0]?.status).toBe("running");
});

it("rejects unsupported, missing, and stale native requests without replying", async () => {
  const { root, run, input } = await fixture();
  const nativeReply = vi.fn<() => Promise<void>>(async () => undefined);
  const adapter = {
    ...mockAdapter,
    capabilities: { ...mockAdapter.capabilities, waitingInput: "supported" as const },
    replyToInput: nativeReply,
  };
  await expect(replyToInput(root, run.snapshot.id, input, mockAdapter)).rejects.toThrow(
    /unavailable/,
  );
  await expect(
    replyToInput(root, run.snapshot.id, { ...input, attemptId: crypto.randomUUID() }, adapter),
  ).rejects.toThrow(/no longer pending/);
  await expect(
    replyToInput(
      root,
      run.snapshot.id,
      { ...input, answers: { other: { answers: ["yes"] } } },
      adapter,
    ),
  ).rejects.toThrow(/Answer each/);
  expect(nativeReply).not.toHaveBeenCalled();
});
