import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeStep, type StepResult } from "../domain/scheduler.js";
import { CHECKOUT_MOVED, checkoutMovedMessage } from "../domain/run-branch.js";
import { snapshotFileDiffs } from "./inspection.js";
import { expireQueuedGuidance } from "./guidance.js";
import { createReviewCopy, listRunChangedFiles } from "./run-branch.js";
import { ensureChangedFilesGate } from "./gates.js";
import { currentBranch, gitTreeState } from "./workspace.js";
import { isActiveStatus } from "./scheduler-constants.js";
import { stepInputs } from "./scheduler-inputs.js";
import { appendLocalEvent, interruptStep } from "./scheduler-evidence.js";
import { runCheckStep } from "./step-check.js";
import { runAgentStep } from "./step-agent.js";
import { recordStepCompletion, revalidateResult } from "./step-finish.js";
import type { RunContext, RunWorkspace, StepFrame } from "./run-context.js";

type LoopStep = StepFrame["definition"];

/** Gather what one claimed attempt needs: its copy, branch check, baseline and inputs. */
const prepareStep = async (
  ctx: RunContext,
  workspace: RunWorkspace,
  stepId: string,
  definition: LoopStep,
  executionDirectory: string,
  hasReviewRoot: boolean,
): Promise<StepFrame> => {
  const { commit, project, runId } = ctx;
  const readonly = definition.stage === "review";
  const verifiesNoChange = workspace.isProjectRun && (readonly || definition.kind === "check");
  const step = ctx.record().steps.find((item) => item.stepId === stepId);
  const attempt = step?.attempts.at(-1);
  if (!step || !attempt) throw new Error("Claimed attempt missing.");
  // A copy failure is a failed attempt, not an interrupted run.
  let copyFailure: string | undefined;
  if (hasReviewRoot)
    copyFailure = await (
      workspace.isWorktreeRun
        ? createReviewCopy(workspace.path, executionDirectory, step.candidateId ?? "")
        : cp(workspace.path, executionDirectory, { recursive: true })
    ).then(
      () => undefined,
      (error: unknown) =>
        `Could not prepare the frozen review copy: ${error instanceof Error ? error.message : String(error)}`,
    );
  if (copyFailure) console.error("Review copy failed", runId, stepId, copyFailure);
  const recovering = ctx.initial.steps.some(
    (item) =>
      item.stepId === stepId &&
      item.attempts.at(-1)?.id === attempt.id &&
      isActiveStatus(item.status),
  );
  if (workspace.isProjectRun && !recovering) {
    // The user may switch branches mid-run; never run a step against another branch's files.
    const branch = ctx.record().snapshot.baseline.branch ?? "";
    const current = await currentBranch(workspace.path);
    if (current !== branch) {
      copyFailure = checkoutMovedMessage(branch, current);
      const detail = copyFailure;
      await commit((latest) =>
        appendLocalEvent(latest, stepId, attempt.id, "check", CHECKOUT_MOVED, detail, "failed"),
      );
    }
  }
  const filesBefore =
    verifiesNoChange && !copyFailure ? (await gitTreeState(workspace.path)).files : null;
  const base = ctx.record().snapshot.baseline.sourceRevision;
  const runChanges =
    workspace.isProjectRun && base && !copyFailure
      ? await listRunChangedFiles(workspace.path, base)
      : null;
  // Template loops call the gate by path, so a deleted `.code-factory/` cannot break a run.
  if (workspace.isProjectRun && !copyFailure) await ensureChangedFilesGate(workspace.path);
  const inputs = stepInputs(ctx.record(), stepId);
  const inspectable =
    workspace.commitsRunBranch ||
    /^\.code-factory\/workspaces\/[0-9a-f-]{36}$/i.test(
      ctx.record().snapshot.baseline.workspace ?? "",
    );
  const beforeFiles =
    !readonly && !recovering && inspectable
      ? await snapshotFileDiffs(project, ctx.record()).catch(() => null)
      : null;
  return {
    stepId,
    definition,
    step,
    attempt,
    readonly,
    executionDirectory,
    recovering,
    copyFailure,
    filesBefore,
    base,
    runChanges,
    inputs,
    beforeFiles,
  };
};

/**
 * Execute one claimed step end to end. The review root is created before the try (a failure there
 * rejects the run), and everything after it, including preparation, is an interruption if it throws.
 */
export const runStep = async (
  ctx: RunContext,
  workspace: RunWorkspace,
  stepId: string,
): Promise<void> => {
  const { commit, signal, initial } = ctx;
  const definition = ctx.record().snapshot.loop.steps.find((step) => step.id === stepId);
  if (!definition) throw new Error(`Unknown step ${stepId}.`);
  const readonly = definition.stage === "review";
  // In-project reviewers and checks run in the project itself; legacy runs keep frozen copies.
  const reviewRoot =
    readonly && !workspace.isProjectRun
      ? await mkdtemp(join(tmpdir(), "factory-review-"))
      : undefined;
  const executionDirectory = reviewRoot ? join(reviewRoot, "candidate") : workspace.path;
  try {
    const frame = await prepareStep(
      ctx,
      workspace,
      stepId,
      definition,
      executionDirectory,
      reviewRoot !== undefined,
    );
    let reported: StepResult;
    let staleCheck = false;
    if (definition.kind === "check")
      ({ result: reported, staleCheck } = await runCheckStep(ctx, workspace, frame));
    else reported = await runAgentStep(ctx, frame);
    const result = await revalidateResult(ctx, workspace, frame, reported);
    await recordStepCompletion(ctx, workspace, frame, result, staleCheck);
  } catch (error) {
    if (isActiveStatus(ctx.record().steps.find((step) => step.stepId === stepId)?.status ?? ""))
      await commit((current) =>
        initial.steps.some((item) => item.stepId === stepId && isActiveStatus(item.status)) ||
        (definition.kind !== "check" && !signal.aborted)
          ? interruptStep(
              current,
              stepId,
              error instanceof Error ? error.message : String(error),
              initial.steps.some((item) => item.stepId === stepId && isActiveStatus(item.status))
                ? "recovery-unavailable"
                : "execution-interrupted",
            )
          : completeStep(current, stepId, {
              status: signal.aborted ? "canceled" : "failed",
              summary: error instanceof Error ? error.message : String(error),
            }),
      );
  } finally {
    const finalAttemptId = ctx
      .record()
      .steps.find((item) => item.stepId === stepId)
      ?.attempts.at(-1)?.id;
    if (finalAttemptId)
      await commit((current) => expireQueuedGuidance(current, stepId, finalAttemptId));
    if (reviewRoot) await rm(reviewRoot, { recursive: true, force: true });
  }
};
