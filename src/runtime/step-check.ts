import type { StepResult } from "../domain/scheduler.js";
import { changedFiles, READ_ONLY_VIOLATION, readOnlyViolation } from "../domain/run-branch.js";
import { fileDigest, gitTreeState } from "./workspace.js";
import { checkEnvironment } from "./scheduler-inputs.js";
import { appendLocalEvent } from "./scheduler-evidence.js";
import { checkCommand } from "./check-command.js";
import type { RunContext, RunWorkspace, StepFrame } from "./run-context.js";

/** Run (or recover) a check step and judge whether it left the candidate unchanged. */
export const runCheckStep = async (
  ctx: RunContext,
  workspace: RunWorkspace,
  frame: StepFrame,
): Promise<{ result: StepResult; staleCheck: boolean }> => {
  const { commit, signal } = ctx;
  const { stepId, definition, step, attempt, recovering, copyFailure, filesBefore } = frame;
  let result: StepResult;
  if (recovering) {
    const completed = ctx
      .record()
      .evidence.find(
        (item) =>
          item.kind === "event" &&
          item.attemptId === attempt.id &&
          item.title === "Check completed",
      );
    if (completed?.kind !== "event")
      throw new Error("A check process cannot be recovered after restart.");
    result = {
      status: completed.state === "succeeded" ? "succeeded" : "failed",
      outcome: completed.state === "succeeded" ? "passed" : "failed",
      ...(completed.detail ? { summary: completed.detail } : {}),
    };
  } else if (copyFailure) {
    result = { status: "failed", outcome: "failed", summary: copyFailure };
  } else {
    await commit((current) =>
      appendLocalEvent(
        current,
        stepId,
        attempt.id,
        "check",
        "Check started",
        definition.instruction,
        "running",
      ),
    );
    result = await checkCommand(
      { shell: definition.instruction },
      frame.executionDirectory,
      signal,
      async (text) => {
        await commit((current) =>
          appendLocalEvent(current, stepId, attempt.id, "check", "Check output", text),
        );
      },
      undefined,
      frame.runChanges && frame.base ? checkEnvironment(frame.base, frame.runChanges) : undefined,
    );
  }
  const checkChanges = filesBefore
    ? changedFiles(filesBefore, (await gitTreeState(workspace.path)).files)
    : null;
  const staleCheck = checkChanges
    ? checkChanges.length > 0
    : (await fileDigest(workspace.path, workspace.mode)) !== step.candidateId;
  if (staleCheck)
    result = {
      status: "failed",
      outcome: "failed",
      summary: checkChanges?.length
        ? readOnlyViolation("Check", checkChanges)
        : "Check changed the candidate; its result is stale.",
      exitCode: result.exitCode ?? null,
    };
  if (checkChanges?.length) {
    const detail = readOnlyViolation("Check", checkChanges);
    await commit((current) =>
      appendLocalEvent(current, stepId, attempt.id, "check", READ_ONLY_VIOLATION, detail, "failed"),
    );
  }
  if (!recovering)
    await commit((current) =>
      appendLocalEvent(
        current,
        stepId,
        attempt.id,
        "check",
        "Check completed",
        result.summary,
        result.status,
      ),
    );
  return { result, staleCheck };
};
