import type { RunRecord } from "../domain/run.js";
import {
  isProjectRun,
  PROJECT_DIRTY,
  READ_ONLY_LEFTOVERS,
  READ_ONLY_VIOLATION,
} from "../domain/run-branch.js";
import { ProjectError } from "./project.js";
import { listRuns } from "./storage.js";
import { resolveRunWorkspace } from "./workspace.js";
import { TERMINAL } from "./run-branch-git.js";
import { isProjectDirty } from "./run-branch-status.js";

export const holdsProject = (record: RunRecord): boolean =>
  isProjectRun(record.snapshot.baseline) && !TERMINAL.has(record.status);

/** Only one in-project run may hold the checkout: refuse while another one is not finished. */
export const assertSoleProjectWriter = async (project: string, runId?: string): Promise<void> => {
  const holder = (await listRuns(project)).find(
    (record) => record.snapshot.id !== runId && holdsProject(record),
  );
  if (holder)
    throw new ProjectError(
      `Run ${holder.snapshot.id.slice(0, 8)} on branch ${holder.snapshot.baseline.branch ?? ""} is still ${holder.status} in this project. Finish or cancel it before starting another run.`,
      409,
    );
};

/**
 * Before an in-project run executes: it is the only writer, the checkout is on its branch, and a
 * first execution starts from a clean tree, so the first step commit holds only agent changes.
 */
export const assertProjectRunCanWrite = async (
  project: string,
  record: RunRecord,
  options: { fresh: boolean },
): Promise<void> => {
  if (!isProjectRun(record.snapshot.baseline)) return;
  await assertSoleProjectWriter(project, record.snapshot.id);
  const resolved = await resolveRunWorkspace(project, record, { legacy: "prefix" });
  if (!(await isProjectDirty(resolved.path))) return;
  if (options.fresh) throw new ProjectError(PROJECT_DIRTY, 409);
  if (hasUnresolvedReadOnlyViolation(record)) throw new ProjectError(READ_ONLY_LEFTOVERS, 409);
};

/**
 * A reviewer or check changed files, and no attempt has started since: those changes are still
 * the violation's, so a later writing step must not commit them under its own name.
 */
export const hasUnresolvedReadOnlyViolation = (record: RunRecord): boolean => {
  const violation = [...record.evidence]
    .reverse()
    .find((item) => item.kind === "event" && item.title === READ_ONLY_VIOLATION);
  if (!violation) return false;
  return !record.steps.some((step) =>
    step.attempts.some((attempt) => attempt.startedAt > violation.createdAt),
  );
};
