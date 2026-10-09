// @vitest-environment jsdom
import { parseLoop } from "../../src/domain/loop.js";
import {
  createRunRecord,
  createRunSnapshot,
  startAttempt,
  type RunRecord,
} from "../../src/domain/run.js";

export const makeRun = (): RunRecord => {
  const loop = parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 2,
    status: "published",
    steps: [
      {
        id: "plan",
        name: "Plan",
        kind: "agent",
        role: "planner",
        instruction: "Plan the work",
        expectedOutputs: ["plan.md"],
        position: { x: 40, y: 70 },
      },
      {
        id: "build",
        name: "Build",
        kind: "agent",
        role: "builder",
        instruction: "Build the work",
        position: { x: 340, y: 20 },
        groupId: "parallel",
      },
      {
        id: "review",
        name: "Review",
        kind: "agent",
        role: "reviewer",
        instruction: "Review the work",
        position: { x: 340, y: 180 },
        groupId: "parallel",
      },
    ],
    dependencies: [
      { from: "plan", to: "build" },
      { from: "plan", to: "review" },
    ],
    groups: [
      { id: "parallel", name: "Parallel work", kind: "parallel", stepIds: ["build", "review"] },
    ],
    joins: [],
    decisions: [],
    policy: {},
  });
  let run = createRunRecord(
    createRunSnapshot(
      loop,
      {
        description: "Build a feature",
        ticket: { id: "T-1", title: "First task", summary: "Task", attachments: [] },
      },
      { provider: "mock", model: "model-a" },
    ),
  );
  run = startAttempt(run, "build");
  run = startAttempt(run, "review");
  const buildAttempt = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  const reviewAttempt = run.steps.find((step) => step.stepId === "review")?.attempts[0]?.id;
  if (!buildAttempt || !reviewAttempt) throw new Error("Missing attempts");
  return {
    ...run,
    evidence: [
      {
        kind: "event" as const,
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "build",
        attemptId: buildAttempt,
        createdAt: new Date().toISOString(),
        type: "message" as const,
        title: "Build message",
        sequence: 0,
      },
      {
        kind: "event" as const,
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "review",
        attemptId: reviewAttempt,
        createdAt: new Date().toISOString(),
        type: "message" as const,
        title: "Review message",
        sequence: 1,
      },
    ],
  };
};
