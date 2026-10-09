import { runRecordSchema, type RunRecord } from "../domain/run.js";
import { appendRunEvent } from "../domain/run-branch.js";
import { mutateRun, readRun } from "./storage.js";
import { ProjectError } from "./project.js";
import { executeOnce } from "./execute-run.js";
import { isActiveStatus, type Resolver } from "./scheduler-constants.js";

const active = new Map<
  string,
  { work: Promise<RunRecord>; controller: AbortController; retry?: string }
>();

/** Whether this runtime is executing the run now; an unfinished run that is not was interrupted. */
export const isRunActive = (project: string, runId: string): boolean =>
  active.has(`${project}:${runId}`);

/** Execute the persisted graph with one scheduler and per-step adapters. Duplicate calls share work. */
export const executeRun = async (
  project: string,
  runId: string,
  resolveAdapter: Resolver,
): Promise<RunRecord> => {
  const key = `${project}:${runId}`;
  const existing = active.get(key);
  if (existing) {
    if (existing.retry) throw new Error("A selected retry is active.");
    return existing.work;
  }
  const controller = new AbortController();
  const work = executeOnce(project, runId, resolveAdapter, controller.signal);
  active.set(key, { work, controller });
  try {
    return await work;
  } finally {
    if (active.get(key)?.work === work) active.delete(key);
  }
};

/**
 * Run maintenance `work` (worktree removal) while holding the run's active slot, so no run, retry
 * or recovery can start until it settles. Returns null without running when the slot is taken.
 */
export const withIdleRunSlot = async (
  project: string,
  runId: string,
  work: () => Promise<RunRecord>,
): Promise<RunRecord | null> => {
  const key = `${project}:${runId}`;
  if (active.has(key)) return null;
  const pending = work();
  active.set(key, { work: pending, controller: new AbortController() });
  try {
    return await pending;
  } finally {
    if (active.get(key)?.work === pending) active.delete(key);
  }
};

/** A repeated request with the same prior attempt shares the one active retry. */
export const retryStep = async (
  project: string,
  runId: string,
  stepId: string,
  expectedAttemptId: string,
  resolveAdapter: Resolver,
): Promise<RunRecord> => {
  const key = `${project}:${runId}`;
  const retry = `${stepId}:${expectedAttemptId}`;
  const existing = active.get(key);
  if (existing) {
    if (existing.retry === retry) return existing.work;
    if (existing.retry) throw new Error("Another selected retry is active for this run.");
    // A failed step is persisted before its original execution has finished cleanup.
    // Wait for that work to settle before claiming the selected retry.
    await existing.work.catch(() => undefined);
    if (active.get(key) === existing) active.delete(key);
    return retryStep(project, runId, stepId, expectedAttemptId, resolveAdapter);
  }
  const controller = new AbortController();
  const work = executeOnce(project, runId, resolveAdapter, controller.signal, {
    stepId,
    expectedAttemptId,
  });
  active.set(key, { work, controller, retry });
  try {
    return await work;
  } finally {
    if (active.get(key)?.work === work) active.delete(key);
  }
};

export const cancelRun = async (project: string, runId: string): Promise<RunRecord> => {
  const running = active.get(`${project}:${runId}`);
  if (running) {
    running.controller.abort();
    return running.work;
  }
  // A run that is not executing (pending, or left "running" between steps by a restart) would
  // otherwise hold an in-project checkout forever, so it can be canceled directly.
  const record = await readRun(project, runId);
  if (!record) throw new ProjectError("Run not found.", 404);
  if (
    !["pending", "running"].includes(record.status) ||
    record.steps.some((step) => isActiveStatus(step.status))
  )
    throw new ProjectError("Run is not executing.", 409);
  return withIdleRunSlot(project, runId, () =>
    mutateRun(project, runId, (current) =>
      ["pending", "running"].includes(current.status) &&
      !current.steps.some((step) => isActiveStatus(step.status))
        ? runRecordSchema.parse({
            ...appendRunEvent(
              current,
              "lifecycle",
              "Run canceled",
              current.status === "pending"
                ? "Canceled before execution."
                : "Canceled while not executing.",
              "canceled",
            ),
            status: "canceled",
          })
        : current,
    ),
  ).then((result) => {
    if (!result) throw new ProjectError("Run is not executing.", 409);
    return result;
  });
};
