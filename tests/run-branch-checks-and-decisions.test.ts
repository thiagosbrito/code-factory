import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mockAdapter } from "../src/adapters/mock.js";
import { type AdapterEvent, type StepExecutionInput } from "../src/adapters/contract.js";
import { parseLoop } from "../src/domain/loop.js";
import { executeRun } from "../src/runtime/scheduler.js";
import {
  acting,
  createProjectRun,
  git,
  implement,
  loopWith,
  outcome,
  parents,
  repository,
  review,
  savedEnv,
  tidy,
  writer,
} from "./support/run-branch.js";

afterEach(async () => {
  process.env = { ...savedEnv };
  await Promise.all(parents.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("in-project run branch", () => {
  it("gives checks the run's changed files and reviewers the same-candidate validation evidence", async () => {
    const { root } = await repository();
    const validate = {
      id: "validate",
      name: "Validate",
      kind: "agent",
      stage: "validation",
      role: "validator",
      instruction: "Validate",
    };
    const scoped = {
      id: "scoped",
      name: "Scoped lint",
      kind: "check",
      stage: "validation",
      role: "checker",
      instruction:
        'test "$CODE_FACTORY_CHANGED_FILES" = "feature.txt" && test -n "$CODE_FACTORY_BASE_REVISION"',
    };
    const run = await createProjectRun(
      root,
      loopWith(
        [implement, validate, scoped, review],
        [
          { from: "implement", to: "validate" },
          { from: "validate", to: "scoped" },
          { from: "scoped", to: "review" },
        ],
      ),
    );
    const instructions: Record<string, string> = {};
    const recording = acting(async (input) => {
      instructions[input.stepId] = input.instruction;
      if (input.stepId === "implement")
        await writeFile(join(input.projectDirectory, "feature.txt"), "feature\n");
    });
    const done = await executeRun(root, run.snapshot.id, () => recording);
    expect(outcome(done)).toEqual({ status: "succeeded", failures: [] });
    expect(instructions.validate).toContain(
      `This run started at commit ${run.snapshot.baseline.sourceRevision}. Files changed by this run so far (1):\nfeature.txt`,
    );
    // The reviewer depends only on the check, yet sees the validation step two hops back.
    expect(instructions.review).toContain("Input from scoped");
    expect(instructions.review).toContain("Input from validate");
    expect(instructions.review).toContain("Input from implement");
  });

  it("provides the changed-files gate to check steps even after .code-factory was deleted", async () => {
    const { root } = await repository();
    const lint = {
      id: "gate-lint",
      name: "Lint changed files",
      kind: "check",
      stage: "validation",
      role: "Changed-files gate",
      instruction: "node .code-factory/gates/changed-files-gate.mjs lint",
    };
    const run = await createProjectRun(
      root,
      loopWith([implement, lint], [{ from: "implement", to: "gate-lint" }]),
    );
    const done = await executeRun(root, run.snapshot.id, () => writer);
    expect(outcome(done)).toEqual({ status: "succeeded", failures: [] });
    const output = done.evidence.find(
      (item) =>
        item.kind === "event" && item.stepId === "gate-lint" && item.title === "Check output",
    );
    // The writer changed only feature.txt, so the gate found nothing to lint.
    expect(output?.kind === "event" && output.detail).toContain("No changed JS/TS files to lint.");
    expect(git(root, "status", "--porcelain", "--", ".", ":(exclude).code-factory")).toBe("");
  });

  it("reads a decision from the first line and records why an undeclared one fails", async () => {
    const decide = {
      id: "adjudicate",
      name: "Verify and adjudicate",
      kind: "agent",
      stage: "validation",
      role: "Adjudicator",
      instruction: "Decide",
    };
    const rework = { ...tidy, id: "rework", name: "Rework", instruction: "Rework" };
    const loop = parseLoop({
      ...loopWith(
        [implement, decide, tidy, rework],
        [
          { from: "implement", to: "adjudicate" },
          { from: "adjudicate", to: "tidy" },
          { from: "adjudicate", to: "rework" },
        ],
      ),
      decisions: [
        {
          stepId: "adjudicate",
          branches: [
            { outcome: "pass", to: "tidy" },
            { outcome: "repair", to: "rework" },
          ],
        },
      ],
    });
    const answering = (answer: string) => ({
      ...mockAdapter,
      async *execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent> {
        if (input.stepId !== "adjudicate") return yield* writer.execute(input, signal);
        const session = {
          runId: input.runId,
          stepId: input.stepId,
          attempt: input.attempt,
          sessionId: "s",
          turnId: "t",
        };
        yield { type: "started", ...session };
        yield { type: "completed", outcome: "succeeded", output: answer, ...session };
      },
    });
    const accepted = await repository();
    const passing = await createProjectRun(accepted.root, loop);
    const done = await executeRun(accepted.root, passing.snapshot.id, () =>
      answering("**pass**\n\nAll six reviews returned pass."),
    );
    expect(outcome(done)).toEqual({ status: "succeeded", failures: [] });
    expect(done.steps.find((step) => step.stepId === "adjudicate")?.outcome).toBe("pass");

    const rejected = await repository();
    const unclear = await createProjectRun(rejected.root, loop);
    const failed = await executeRun(rejected.root, unclear.snapshot.id, () =>
      answering("Looks good to me\nship it"),
    );
    expect(failed.status).toBe("failed");
    const reason = failed.evidence.find(
      (item) => item.kind === "event" && item.title === "result-rejected",
    );
    expect(reason?.kind === "event" && reason.detail).toBe(
      "Undeclared decision outcome: Looks good to me",
    );
  });
});
