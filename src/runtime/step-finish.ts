import { completeStep, type StepResult } from "../domain/scheduler.js";
import { isIssueBlockedOutput } from "../domain/ticket.js";
import { changedFiles, READ_ONLY_VIOLATION, readOnlyViolation } from "../domain/run-branch.js";
import { snapshotFileDiffs } from "./inspection.js";
import { commitStepChanges } from "./run-branch.js";
import { fileDigest, gitTreeState } from "./workspace.js";
import { RESULT_REJECTED, writesRunBranch } from "./scheduler-inputs.js";
import { appendFileReceipts, appendLocalEvent, appendReceipt } from "./scheduler-evidence.js";
import type { RunContext, RunWorkspace, StepFrame } from "./run-context.js";

/**
 * Hold a reported result to Code Factory's own rules: reviewers and checks must not change the
 * project, a blocked issue lookup is a failure, and decisions and verdicts must be declared.
 */
export const revalidateResult = async (
  ctx: RunContext,
  workspace: RunWorkspace,
  frame: StepFrame,
  reportedResult: StepResult,
): Promise<StepResult> => {
  const { commit } = ctx;
  const { stepId, definition, step, attempt, copyFailure, filesBefore } = frame;
  const readonly = frame.readonly;
  let result = reportedResult;
  if (readonly && filesBefore) {
    const reviewChanges = changedFiles(filesBefore, (await gitTreeState(workspace.path)).files);
    if (reviewChanges.length && result.status !== "canceled") {
      result = { status: "failed", summary: readOnlyViolation("Reviewer", reviewChanges) };
      const detail = result.summary;
      await commit((current) =>
        appendLocalEvent(
          current,
          stepId,
          attempt.id,
          "check",
          READ_ONLY_VIOLATION,
          detail,
          "failed",
        ),
      );
    }
  } else if (
    readonly &&
    !copyFailure &&
    result.status === "succeeded" &&
    (await fileDigest(frame.executionDirectory, workspace.mode)) !== step.candidateId
  )
    result = { status: "failed", summary: "Reviewer changed the frozen candidate." };
  const reported = result;
  const blockedSummary = result.summary;
  if (
    result.status === "succeeded" &&
    ctx.record().snapshot.task.ticketId &&
    blockedSummary !== undefined &&
    isIssueBlockedOutput(blockedSummary, ctx.record().snapshot.task.ticketId ?? "")
  )
    result = { status: "failed", summary: blockedSummary };
  const decision = ctx.record().snapshot.loop.decisions.find((item) => item.stepId === stepId);
  if (
    result.status === "succeeded" &&
    decision &&
    !decision.branches.some((branch) => branch.outcome === result.outcome)
  )
    result = {
      status: "failed",
      summary: `Undeclared decision outcome: ${result.outcome ?? "none"}`,
    };
  if (
    result.status === "succeeded" &&
    definition.stage === "review" &&
    (!["pass", "changes-requested", "blocked"].includes(result.outcome ?? "") ||
      (result.outcome === "changes-requested" && !result.findings?.length))
  )
    result = {
      status: "failed",
      summary:
        result.outcome === "changes-requested"
          ? "Review requested changes without actionable findings."
          : `Undeclared review verdict: ${result.outcome ?? "none"}`,
    };
  if (reported.status === "succeeded" && result.status === "failed" && result.summary) {
    // The agent said it succeeded; record why Code Factory did not accept that result.
    const detail = result.summary;
    await commit((current) =>
      appendLocalEvent(current, stepId, attempt.id, "check", RESULT_REJECTED, detail, "failed"),
    );
  }
  return result;
};

/** Commit the step's changes, complete the attempt, then record file and check/review receipts. */
export const recordStepCompletion = async (
  ctx: RunContext,
  workspace: RunWorkspace,
  frame: StepFrame,
  validated: StepResult,
  staleCheck: boolean,
): Promise<void> => {
  const { commit, project } = ctx;
  const { stepId, definition, step, attempt, inputs, beforeFiles } = frame;
  let result = validated;
  // Commit after every result re-validation and before the digest, so hook edits (formatters)
  // belong to the recorded candidate and a failed result never reaches the branch.
  if (
    result.status === "succeeded" &&
    workspace.commitsRunBranch &&
    writesRunBranch(ctx.record(), stepId)
  ) {
    const outcome = await commitStepChanges(workspace.path, ctx.record(), stepId, attempt);
    if (outcome.kind === "committed")
      await commit((current) =>
        appendLocalEvent(
          current,
          stepId,
          attempt.id,
          "lifecycle",
          "commit-created",
          `${outcome.sha} ${outcome.subject}`,
        ),
      );
    if (outcome.kind === "failed") {
      await commit((current) =>
        appendLocalEvent(
          current,
          stepId,
          attempt.id,
          "check",
          "commit-failed",
          `Exit ${outcome.exitCode ?? "none"}\n${outcome.output}`,
          "failed",
        ),
      );
      result = { status: "failed", summary: outcome.summary };
    }
  }
  const candidateId =
    definition.kind === "check" && step.candidateId
      ? step.candidateId
      : await fileDigest(workspace.path, workspace.mode);
  await commit((current) => completeStep(current, stepId, { ...result, candidateId }));
  if (beforeFiles) {
    const afterFiles = await snapshotFileDiffs(project, ctx.record()).catch(() => null);
    if (afterFiles)
      await commit((current) =>
        appendFileReceipts(
          current,
          stepId,
          attempt.id,
          beforeFiles,
          afterFiles,
          inputs.receiptIds,
          definition.kind === "check" ? "check" : "agent",
          staleCheck,
        ),
      );
  }
  if (
    definition.kind === "check" ||
    (definition.stage === "review" && result.status === "succeeded")
  )
    await commit((current) =>
      appendReceipt(
        current,
        stepId,
        attempt.id,
        definition.instruction,
        result,
        inputs.receiptIds,
        staleCheck,
      ),
    );
};
