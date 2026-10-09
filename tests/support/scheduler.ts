import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { mockAdapter } from "../../src/adapters/mock.js";
import { type AdapterEvent } from "../../src/adapters/contract.js";
import { createRun } from "../../src/runtime/storage.js";
import { parseLoop } from "../../src/domain/loop.js";
import { createRunRecord, createRunSnapshot, type RunRecord } from "../../src/domain/run.js";
import { claimStep, completeStep } from "../../src/domain/scheduler.js";

export const step = (
  id: string,
  stage: "implementation" | "review" = "review",
  groupId?: string,
) => ({
  id,
  name: id,
  kind: "agent" as const,
  stage,
  role: id,
  instruction: id,
  ...(groupId ? { groupId } : {}),
});

export const run = (input: Record<string, unknown> = {}): RunRecord => {
  const loop = parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 1,
    status: "published",
    steps: [
      step("build", "implementation"),
      step("quality", "review", "reviews"),
      step("security", "review", "reviews"),
      step("join"),
    ],
    dependencies: [
      { from: "build", to: "quality" },
      { from: "build", to: "security" },
      { from: "quality", to: "join" },
      { from: "security", to: "join" },
    ],
    groups: [
      { id: "reviews", name: "Reviews", kind: "parallel", stepIds: ["quality", "security"] },
    ],
    joins: [{ stepId: "join", mode: "all", from: ["quality", "security"] }],
    decisions: [],
    policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 2 },
    ...input,
  });
  return createRunRecord(
    createRunSnapshot(loop, { description: "Task" }, { provider: "mock", model: "default" }),
  );
};

export const claim = (record: RunRecord, id: string): RunRecord =>
  claimStep(record, id, "candidate-a", "input-a");

export const pass = (record: RunRecord, id: string, outcome?: string): RunRecord =>
  completeStep(record, id, { status: "succeeded", ...(outcome ? { outcome } : {}) });

export type ScriptedInstructions = Record<string, string[]>;

/** Replies with the next scripted output per step and records each instruction it received. */
export const scriptedAdapter = (
  outputs: Record<string, string[]>,
  instructions: ScriptedInstructions,
  outcome: "succeeded" | "failed" = "succeeded",
) => ({
  ...mockAdapter,
  async *execute(input: Parameters<typeof mockAdapter.execute>[0]): AsyncIterable<AdapterEvent> {
    const seen = (instructions[input.stepId] ??= []);
    seen.push(input.instruction);
    const session = {
      runId: input.runId,
      stepId: input.stepId,
      attempt: input.attempt,
      sessionId: crypto.randomUUID(),
      turnId: crypto.randomUUID(),
    };
    yield { type: "started", ...session };
    yield {
      type: "completed",
      outcome,
      output: outputs[input.stepId]?.[seen.length - 1] ?? outputs[input.stepId]?.at(-1) ?? "",
      ...session,
    };
  },
});

export const reviewerIds = ["r1", "r2", "r3", "r4", "r5", "r6"];

export const blockedLoop = (input: Record<string, unknown> = {}) =>
  parseLoop({
    schemaVersion: 2,
    id: "reviews",
    name: "Reviews",
    version: 1,
    status: "published",
    steps: [
      step("build", "implementation"),
      ...reviewerIds.map((id) => step(id, "review", "panel")),
      { ...step("adjudicate", "implementation"), name: "Adjudicate" },
    ],
    dependencies: [
      ...reviewerIds.map((id) => ({ from: "build", to: id })),
      ...reviewerIds.map((id) => ({ from: id, to: "adjudicate" })),
    ],
    groups: [{ id: "panel", name: "Panel", kind: "parallel", stepIds: reviewerIds }],
    joins: [{ stepId: "adjudicate", mode: "all", from: reviewerIds }],
    decisions: [],
    policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 1 },
    ...input,
  });

export const legacyRun = async (root: string, loop = blockedLoop(), provider = "mock") => {
  await mkdir(join(root, ".code-factory", "workspaces", "candidate"), { recursive: true });
  const record = createRunRecord(
    createRunSnapshot(
      loop,
      { description: "Task" },
      { provider: provider as "mock", model: "default" },
      {
        id: "baseline",
        kind: "git",
        revision: "abc",
        workspace: ".code-factory/workspaces/candidate",
        capturedAt: new Date().toISOString(),
      },
    ),
  );
  await createRun(root, record);
  return record;
};
