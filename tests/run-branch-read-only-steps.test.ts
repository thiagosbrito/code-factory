import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { StepExecutionInput } from "../src/adapters/contract.js";
import { mockAdapter } from "../src/adapters/mock.js";
import { parseLoop } from "../src/domain/loop.js";
import { attachAttemptSession } from "../src/domain/run.js";
import { READ_ONLY_LEFTOVERS } from "../src/domain/run-branch.js";
import { claimStep } from "../src/domain/scheduler.js";
import { assertProjectRunCanWrite } from "../src/runtime/run-branch.js";
import { startLocalServer } from "../src/runtime/server.js";
import { mutateRun } from "../src/runtime/storage.js";
import { trustProject } from "../src/runtime/trust.js";
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

describe("read-only step violations and recovery", { timeout: 30_000 }, () => {
  it("refuses to continue a worktree run over an analytical step's leftovers until they are resolved", async () => {
    const { root } = await repository();
    const adapter = acting(async (input) => {
      if (input.stepId === "planning")
        await writeFile(join(input.projectDirectory, "file.txt"), "planned edit\n");
    });
    const run = await createLegacyWorktreeRun(root, loop());
    const failed = await executeRun(root, run.snapshot.id, () => adapter);
    expect(failed.status).toBe("failed");
    await expect(assertProjectRunCanWrite(root, failed, { fresh: false })).rejects.toThrow(
      READ_ONLY_LEFTOVERS,
    );
    git(worktreeOf(root, run), "checkout", "--", "file.txt");
    await expect(assertProjectRunCanWrite(root, failed, { fresh: false })).resolves.toBeUndefined();
  });

  it("fails a writing evidence step in a parallel group, commits nothing and does not start its sibling", async () => {
    const { root } = await repository();
    const pair = [
      { ...evidence, id: "one", groupId: "pair" },
      { ...evidence, id: "two", groupId: "pair" },
    ];
    const parallel = parseLoop({
      schemaVersion: 2,
      id: "flow",
      name: "Flow",
      version: 1,
      status: "published",
      steps: pair,
      dependencies: [],
      groups: [{ id: "pair", name: "Pair", kind: "parallel", stepIds: ["one", "two"] }],
      joins: [],
      decisions: [],
      policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 1 },
    });
    const started: string[] = [];
    const adapter = acting(async (input) => {
      started.push(input.stepId);
      if (input.stepId === "one")
        await writeFile(join(input.projectDirectory, "feature.txt"), "premature\n");
    });
    const run = await createProjectRun(root, parallel);
    const done = await executeRun(root, run.snapshot.id, () => adapter);
    expect(done.status).toBe("failed");
    // Group members currently run one at a time, so the violation stops the sibling before it starts.
    expect(started).toEqual(["one"]);
    expect(outcome(done).failures).toEqual([
      expect.stringContaining("one: Evidence step changed project files"),
    ]);
    expect(subjects(root)).toBe("");
  });

  it("does not reattach to an in-flight evidence step after a crash; it becomes recovery-unavailable", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root, loopWith([evidence], []));
    await mutateRun(root, run.snapshot.id, (current) =>
      claimStep(current, "evidence", "candidate", "input"),
    );
    await mutateRun(root, run.snapshot.id, (current) =>
      attachAttemptSession(current, "evidence", "session", "turn"),
    );
    let attached = false;
    const resumable = {
      ...mockAdapter,
      capabilities: { ...mockAdapter.capabilities, resume: "supported" as const },
      attach: (...args: Parameters<typeof mockAdapter.attach>) => {
        attached = true;
        return mockAdapter.attach(...args);
      },
    };
    const done = await executeRun(root, run.snapshot.id, () => resumable);
    expect(attached).toBe(false);
    expect(
      done.evidence.some((item) => item.kind === "event" && item.title === "recovery-unavailable"),
    ).toBe(true);
    expect(done.steps[0]?.attempts[0]?.status).toBe("interrupted");
  });

  it("answers 409 with the leftovers message when retrying a dirty legacy worktree run", async () => {
    const { root } = await repository();
    const adapter = acting(async (input) => {
      if (input.stepId === "planning")
        await writeFile(join(input.projectDirectory, "file.txt"), "planned edit\n");
    });
    const run = await createLegacyWorktreeRun(root, loop());
    const failed = await executeRun(root, run.snapshot.id, () => adapter);
    const attemptId = failed.steps.find((step) => step.stepId === "planning")?.attempts.at(-1)?.id;
    await trustProject(root);
    const { server, url } = await startLocalServer({
      sessionToken: null,
      projectDirectory: root,
      port: 0,
    });
    try {
      const response = await fetch(`${url}/api/runs/${run.snapshot.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: "planning", attemptId }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: READ_ONLY_LEFTOVERS });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
