import { lstat, realpath, rmdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunRecord } from "../domain/run.js";
import { runRecordSchema } from "../domain/run.js";
import { appendRunEvent, REMOVAL_DIRTY } from "../domain/run-branch.js";
import { ProjectError } from "./project.js";
import { mutateRun, readRun } from "./storage.js";
import { resolveRunWorkspace } from "./workspace.js";
import { TERMINAL, runGit, firstLine, isCode, withRepoLock } from "./run-branch-git.js";
import { isRemovalBlockedByChanges } from "./run-branch-status.js";
import { projectRunPath } from "./run-branch-workspace.js";

/**
 * Non-forced removal after the removal dirty rule. Git stays the final authority; its refusals
 * become clear 409s and nothing changes. Branches are always kept.
 */
export const removeRunWorktree = async (project: string, runId: string): Promise<RunRecord> => {
  const record = await readRun(project, runId);
  if (!record) throw new ProjectError("Run not found.", 404);
  if (!TERMINAL.has(record.status))
    throw new ProjectError("Finish or cancel the run before removing its worktree.", 409);
  const path = await projectRunPath(project, record);
  if (!path) throw new ProjectError("Legacy runs have no run worktree.", 409);
  const branch = record.snapshot.baseline.branch ?? "";
  if (record.worktree)
    throw new ProjectError(
      `This run's worktree was already removed; branch ${branch} is kept.`,
      409,
    );
  const real = await realpath(project);
  await withRepoLock(real, async () => {
    const present = await lstat(path).catch((error: unknown) => {
      if (isCode(error, "ENOENT")) return null;
      throw error;
    });
    if (present) {
      const resolved = await resolveRunWorkspace(project, record, { legacy: "prefix" });
      if (await isRemovalBlockedByChanges(resolved.path))
        throw new ProjectError(REMOVAL_DIRTY, 409);
      const removed = await runGit(real, ["worktree", "remove", resolved.path]);
      if (removed.code !== 0) {
        const stderr = removed.stderr;
        throw new ProjectError(
          stderr.includes("contains modified or untracked files")
            ? REMOVAL_DIRTY
            : stderr.includes("cannot remove a locked working tree")
              ? `The worktree is locked. Run \`git worktree unlock ${resolved.path}\` first.`
              : `Git refused to remove the worktree: ${firstLine(stderr)}`,
          409,
        );
      }
    }
    await runGit(real, ["worktree", "prune"]);
    await rmdir(dirname(path)).catch((error: unknown) => {
      if (!isCode(error, "ENOTEMPTY") && !isCode(error, "EEXIST") && !isCode(error, "ENOENT"))
        throw error;
    });
  });
  return mutateRun(project, runId, (current) =>
    appendRunEvent(
      runRecordSchema.parse({ ...current, worktree: { removedAt: new Date().toISOString() } }),
      "lifecycle",
      "worktree-removed",
      `Removed ${path}. Branch ${branch} is kept.`,
      "succeeded",
    ),
  );
};
