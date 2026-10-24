import { runRecordSchema, type RunRecord } from "../domain/run.js";
import {
  claimStep,
  continueRepeat,
  hashInputs,
  readySteps,
  selectRunnable,
  prepareStepRetry,
  settleRun,
  skipInactive,
} from "../domain/scheduler.js";
import { readRun, isRunPersistenceError } from "./storage.js";
import { fileDigest, gitTreeState } from "./workspace.js";
import { FINISHED_RUN, isActiveStatus, type Resolver } from "./scheduler-constants.js";
import { stepInputs } from "./scheduler-inputs.js";
import { createRunContext } from "./run-context.js";
import { openRunWorkspace, runSetup } from "./run-prepare.js";
import { runStep } from "./step-runner.js";
import type { TreeFiles } from "./run-context.js";

export const executeOnce = async (
  project: string,
  runId: string,
  resolveAdapter: Resolver,
  signal: AbortSignal,
  retry?: { stepId: string; expectedAttemptId: string },
  onWriteFailure: (error: unknown) => void = () => undefined,
): Promise<RunRecord> => {
  const initial = await readRun(project, runId);
  if (!initial) throw new Error("Run not found.");
  // A run canceled (or otherwise finished) between the execute request and this slot stays put;
  // in particular its setup command must not run in the user's checkout after a cancel.
  if (!retry && FINISHED_RUN.has(initial.status)) return initial;
  const ctx = createRunContext(project, runId, initial, signal, resolveAdapter, onWriteFailure);
  const runSteps = async (ids: string[], sharedBaseline?: TreeFiles) => {
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        try {
          await runStep(ctx, workspace, id, sharedBaseline);
        } catch (error) {
          if (ctx.writeFailed() || isRunPersistenceError(error)) onWriteFailure(error);
          throw error;
        }
      }),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  };
  const { commit } = ctx;
  const opened = await openRunWorkspace(ctx);
  if (opened.kind === "done") return opened.record;
  const { workspace } = opened;
  const stopped = await runSetup(ctx, workspace, Boolean(retry));
  if (stopped) return stopped;

  if (retry) {
    ctx.setRecord(
      await commit((current) => prepareStepRetry(current, retry.stepId, retry.expectedAttemptId)),
    );
    const candidateId = await fileDigest(workspace.path, workspace.mode);
    const inputs = stepInputs(ctx.record(), retry.stepId, candidateId);
    const inputHash = hashInputs(candidateId, [inputs.context, JSON.stringify(inputs.identities)]);
    ctx.setRecord(
      await commit((current) => claimStep(current, retry.stepId, candidateId, inputHash)),
    );
    await runStep(ctx, workspace, retry.stepId);
    if (ctx.record().status !== "running") return ctx.record();
  }

  const interrupted = ctx.record().steps.filter((step) => isActiveStatus(step.status));
  if (interrupted.length) {
    await runSteps(interrupted.map((step) => step.stepId));
    if (ctx.record().status === "unavailable") return ctx.record();
  }
  for (;;) {
    if (ctx.record().status === "unavailable") return ctx.record();
    if (signal.aborted)
      return commit((current) =>
        runRecordSchema.parse({
          ...current,
          revision: current.revision + 1,
          status: "canceled",
        }),
      );
    ctx.setRecord(await commit(skipInactive));
    const repeat = ctx
      .record()
      .snapshot.loop.groups.find(
        (group) =>
          group.kind === "repeat" &&
          ctx.record().steps.find((step) => step.stepId === group.exitWhen.stepId)?.outcome ===
            group.continueWhen.outcome,
      );
    if (repeat?.kind === "repeat") {
      ctx.setRecord(await commit((current) => continueRepeat(current, repeat.exitWhen.stepId)));
      if (ctx.record().status === "rejected") return ctx.record();
    }
    const ready = readySteps(ctx.record());
    if (!ready.length) return commit(settleRun);
    const candidateId = await fileDigest(workspace.path, workspace.mode);
    const selected = selectRunnable(ctx.record(), ready);
    // Overlapping read-only steps are all checked against one tree taken before any starts.
    const sharedBaseline =
      selected.length > 1 && (workspace.isProjectRun || workspace.isWorktreeRun)
        ? (await gitTreeState(workspace.path)).files
        : undefined;
    const launched: string[] = [];
    for (const definition of selected) {
      const inputs = stepInputs(ctx.record(), definition.id, candidateId);
      const inputHash = hashInputs(candidateId, [
        inputs.context,
        JSON.stringify(inputs.identities),
      ]);
      ctx.setRecord(
        await commit((current) => claimStep(current, definition.id, candidateId, inputHash)),
      );
      launched.push(definition.id);
    }
    await runSteps(launched, sharedBaseline);
  }
};
