import type { Baseline } from "../domain/run.js";
import { createRunWorktree } from "./run-branch.js";

/**
 * A run worktree beside the repository receives the selected HEAD plus tracked edits, deletions
 * and untracked files, committed on the run branch as its baseline when the tree was dirty.
 */
export const captureGitBaseline = (
  project: string,
  options: { runId: string; ticketId: string },
): Promise<Baseline> => createRunWorktree(project, options);
