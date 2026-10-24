import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { StepExecutionInput } from "../src/adapters/contract.js";
import { writesRunBranch } from "../src/runtime/scheduler-inputs.js";
import { executeRun } from "../src/runtime/scheduler.js";
import {
  acting,
  createLegacyWorktreeRun,
  createProjectRun,
  git,
  implement,
  loopWith,
  outcome,
  removeParents,
  repository,
  review,
  savedEnv,
  worktreeOf,
} from "./support/run-branch.js";

afterEach(async () => {
  process.env = { ...savedEnv };
  await removeParents();
});

const evidence = {
  id: "evidence",
  name: "Requirements and baseline",
  kind: "agent",
  stage: "evidence",
  role: "analyst",
  instruction: "Gather evidence",
};
const planning = {
  id: "planning",
  name: "Plan",
  kind: "agent",
  stage: "planning",
  role: "planner",
  instruction: "Plan",
};
const loop = () =>
  loopWith(
    [evidence, planning, implement, review],
    [
      { from: "evidence", to: "planning" },
      { from: "planning", to: "implement" },
      { from: "implement", to: "review" },
    ],
  );

const subjects = (cwd: string) => git(cwd, "log", "--format=%s", "main..HEAD");

// These tests execute real Git processes and multiple persisted transitions.
describe("read-only evidence and planning steps", { timeout: 30_000 }, () => {
  it("asks adapters for read-only access on evidence, planning and review, and only commits implementation", async () => {
    const { root } = await repository();
    const seen = new Map<string, boolean | undefined>();
    const adapter = acting(async (input: StepExecutionInput) => {
      seen.set(input.stepId, input.readOnly);
      if (input.stepId === "implement")
        await writeFile(join(input.projectDirectory, "feature.txt"), "feature\n");
    });
    const run = await createProjectRun(root, loop());
    const done = await executeRun(root, run.snapshot.id, () => adapter);
    expect(outcome(done)).toEqual({ status: "succeeded", failures: [] });
    expect(seen.get("evidence")).toBe(true);
    expect(seen.get("planning")).toBe(true);
    expect(seen.get("review")).toBe(true);
    expect(seen.get("implement")).toBeUndefined();
    expect(subjects(root).split("\n")).toEqual([expect.stringContaining("(implement)")]);
    expect(writesRunBranch(done, "evidence")).toBe(false);
    expect(writesRunBranch(done, "planning")).toBe(false);
    expect(writesRunBranch(done, "implement")).toBe(true);
  });

  it("fails an evidence step that changes the project, commits nothing and reverts nothing", async () => {
    const { root } = await repository();
    const adapter = acting(async (input) => {
      if (input.stepId === "evidence")
        await writeFile(join(input.projectDirectory, "feature.txt"), "premature\n");
    });
    const run = await createProjectRun(root, loop());
    const done = await executeRun(root, run.snapshot.id, () => adapter);
    expect(done.status).toBe("failed");
    const { failures } = outcome(done);
    expect(failures[0]).toContain("Evidence step changed project files");
    expect(failures[0]).toContain("added feature.txt");
    expect(subjects(root)).toBe("");
    expect(await readFile(join(root, "feature.txt"), "utf8")).toBe("premature\n");
    expect(done.steps.find((step) => step.stepId === "planning")?.status).not.toBe("succeeded");
  });

  it("fails a planning step that edits a tracked file in a legacy worktree run, uncommitted", async () => {
    const { root } = await repository();
    const adapter = acting(async (input) => {
      if (input.stepId === "planning")
        await writeFile(join(input.projectDirectory, "file.txt"), "planned edit\n");
    });
    const run = await createLegacyWorktreeRun(root, loop());
    const done = await executeRun(root, run.snapshot.id, () => adapter);
    expect(done.status).toBe("failed");
    expect(outcome(done).failures.join("\n")).toContain("Planning step changed project files");
    expect(subjects(worktreeOf(root, run))).toBe("");
  });

  it("keeps writing for a step without a stage", async () => {
    const { root } = await repository();
    const stageless = {
      id: "implement",
      name: "Implement",
      kind: "agent",
      role: "dev",
      instruction: "Implement",
    };
    const adapter = acting(async (input) => {
      expect(input.readOnly).toBeUndefined();
      await writeFile(join(input.projectDirectory, "feature.txt"), "feature\n");
    });
    const run = await createProjectRun(root, loopWith([stageless], []));
    const done = await executeRun(root, run.snapshot.id, () => adapter);
    expect(outcome(done)).toEqual({ status: "succeeded", failures: [] });
    expect(subjects(root)).toContain("(implement)");
  });
});
