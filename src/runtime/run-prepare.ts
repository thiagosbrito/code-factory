import { runRecordSchema, type RunRecord } from "../domain/run.js";
import { formatCommandLine } from "../domain/project.js";
import {
  appendRunEvent,
  SETUP_COMPLETED,
  SETUP_OUTPUT,
  SETUP_STARTED,
} from "../domain/run-branch.js";
import { ProjectError } from "./project.js";
import { listUncommittedPaths } from "./run-branch.js";
import { resolveRunWorkspace, type ResolvedWorkspace } from "./workspace.js";
import { SETUP_TIMEOUT_MS, isActiveStatus } from "./scheduler-constants.js";
import { interruptStep } from "./scheduler-evidence.js";
import { checkCommand } from "./check-command.js";
import type { RunContext, RunWorkspace } from "./run-context.js";

type OpenedWorkspace =
  | { kind: "ready"; workspace: RunWorkspace }
  | { kind: "done"; record: RunRecord };

/** Resolve where the run executes, or finish early when the recorded workspace cannot be used. */
export const openRunWorkspace = async (ctx: RunContext): Promise<OpenedWorkspace> => {
  const { commit } = ctx;
  let resolved: ResolvedWorkspace;
  try {
    resolved = await resolveRunWorkspace(ctx.project, ctx.record(), { legacy: "prefix" });
  } catch (error) {
    // An in-project run whose checkout moved while the runtime was down: its active attempts are
    // interrupted (their processes are gone), and nothing is switched back automatically.
    if (error instanceof ProjectError && error.status === 409) {
      const reason = error.message;
      const activeSteps = ctx.record().steps.filter((step) => isActiveStatus(step.status));
      if (!activeSteps.length) throw error;
      for (const step of activeSteps)
        await commit((current) =>
          interruptStep(current, step.stepId, reason, "recovery-unavailable"),
        );
      return { kind: "done", record: ctx.record() };
    }
    // A removed or missing run worktree is reported, never re-created (FR6.2).
    const recoverable =
      error instanceof ProjectError &&
      error.status === 404 &&
      Boolean(ctx.record().snapshot.baseline.branch) &&
      (["pending", "running"].includes(ctx.record().status) ||
        ctx.record().steps.some((step) => isActiveStatus(step.status)));
    if (!recoverable) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    const activeSteps = ctx.record().steps.filter((step) => isActiveStatus(step.status));
    if (activeSteps.length) {
      for (const step of activeSteps)
        await commit((current) =>
          interruptStep(current, step.stepId, reason, "recovery-unavailable"),
        );
      return { kind: "done", record: ctx.record() };
    }
    return {
      kind: "done",
      record: await commit((current) =>
        runRecordSchema.parse({
          ...appendRunEvent(current, "lifecycle", "worktree-missing", reason, "unknown"),
          status: "unavailable",
        }),
      ),
    };
  }
  const isWorktreeRun = resolved.kind === "worktree";
  const isProjectRun = resolved.kind === "project";
  return {
    kind: "ready",
    workspace: {
      path: resolved.path,
      mode: resolved.digestMode,
      isWorktreeRun,
      isProjectRun,
      commitsRunBranch: isWorktreeRun || isProjectRun,
    },
  };
};

/**
 * Run the project's setup command once before the first attempt. Returns the final record when
 * setup did not succeed (the run stops), or null to carry on with the graph.
 */
export const runSetup = async (
  ctx: RunContext,
  workspace: RunWorkspace,
  retrying: boolean,
): Promise<RunRecord | null> => {
  const { commit, signal } = ctx;
  const setupCommand = ctx.record().snapshot.setupCommand;
  const setupDone = ctx
    .record()
    .evidence.some(
      (item) =>
        item.kind === "event" &&
        !item.stepId &&
        item.title === SETUP_COMPLETED &&
        item.state === "succeeded",
    );
  if (
    retrying ||
    !setupCommand ||
    setupDone ||
    ctx.record().steps.some((step) => step.attempts.length)
  )
    return null;
  if (ctx.record().status === "pending")
    await commit((current) =>
      runRecordSchema.parse({ ...current, revision: current.revision + 1, status: "running" }),
    );
  await commit((current) =>
    appendRunEvent(current, "check", SETUP_STARTED, formatCommandLine(setupCommand)),
  );
  const outcome = await checkCommand(
    { argv: setupCommand },
    workspace.path,
    signal,
    async (text) => {
      await commit((current) => appendRunEvent(current, "check", SETUP_OUTPUT, text));
    },
    SETUP_TIMEOUT_MS,
  );
  const output = outcome.output ?? "";
  const state =
    outcome.status === "succeeded"
      ? "succeeded"
      : outcome.status === "canceled"
        ? "canceled"
        : "failed";
  const spawnFailed = outcome.spawnFailed === true;
  let detail = spawnFailed
    ? `Could not start ${setupCommand[0] ?? ""}: ${outcome.spawnErrorCode ?? outcome.summary ?? "unknown error"}`
    : state === "canceled"
      ? `Canceled\n${output}`
      : outcome.timedOut
        ? `Timed out after ${SETUP_TIMEOUT_MS / 1000} s\n${output}`
        : `Exit ${outcome.exitCode ?? "none"}\n${output}`;
  if (state === "succeeded" && workspace.commitsRunBranch) {
    const changed = await listUncommittedPaths(workspace.path).catch(() => []);
    if (changed.length)
      detail += `\nChanged tracked files: ${changed.slice(0, 50).join(", ")}${changed.length > 50 ? ` and ${changed.length - 50} more` : ""}`;
  }
  ctx.setRecord(
    await commit((current) => {
      const next = appendRunEvent(current, "check", SETUP_COMPLETED, detail.trimEnd(), state);
      return state === "succeeded" ? next : runRecordSchema.parse({ ...next, status: state });
    }),
  );
  return state === "succeeded" ? null : ctx.record();
};
