import { git } from "./run-branch-git.js";

/**
 * Every read-only status probe passes this global option. Without it `git status` refreshes the
 * index under `index.lock`, and a UI poll could then make a concurrent step commit fail.
 */
export const NO_OPTIONAL_LOCKS = "--no-optional-locks";

export const promotionStatusArgs = [
  NO_OPTIONAL_LOCKS,
  "status",
  "--porcelain",
  "-z",
  "--untracked-files=all",
  "--",
  ".",
  ":(exclude).code-factory",
] as const;

/** Promotion dirty rule: would the committed branch differ from what the user sees? */
export const isPromotionDirty = async (worktree: string): Promise<boolean> =>
  (await git(worktree, ...promotionStatusArgs)).length > 0;

/**
 * Removal dirty rule. Mirrors `git worktree remove` (no --force): any tracked change or any
 * non-ignored untracked file blocks, including `.code-factory/...` when the repo does not ignore
 * it. `--untracked-files=all` is forced so `status.showUntrackedFiles=no` cannot hide untracked
 * files that Git would then delete silently.
 */
export const isRemovalBlockedByChanges = async (worktree: string): Promise<boolean> =>
  (
    await git(
      worktree,
      NO_OPTIONAL_LOCKS,
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=none",
    )
  ).length > 0;

/** Tracked paths that differ from HEAD, excluding `.code-factory`. */
export const listUncommittedPaths = async (worktree: string): Promise<string[]> =>
  (
    await git(
      worktree,
      NO_OPTIONAL_LOCKS,
      "status",
      "--porcelain",
      "-z",
      "--no-renames",
      "--",
      ".",
      ":(exclude).code-factory",
    )
  )
    .split("\0")
    .filter((entry) => entry && !entry.startsWith("??"))
    .map((entry) => entry.slice(3));

/**
 * Files that exist now and differ from the run's start commit: committed run work, uncommitted
 * edits and new untracked files, without deletions, ignored files or `.code-factory`. Check
 * commands receive them so lint, type and coverage gates can scope to the run's changes.
 */
export const listRunChangedFiles = async (project: string, base: string): Promise<string[]> => {
  const tracked = await git(
    project,
    NO_OPTIONAL_LOCKS,
    "diff",
    "--name-only",
    "--no-renames",
    "--diff-filter=d",
    "-z",
    base,
    "--",
    ".",
    ":(exclude).code-factory",
  );
  const untracked = await git(
    project,
    NO_OPTIONAL_LOCKS,
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ".",
    ":(exclude).code-factory",
  );
  return [...new Set(`${tracked}${untracked}`.split("\0").filter(Boolean))].sort();
};

/** Uncommitted tracked or non-ignored untracked changes, excluding Code Factory's own data. */
export const isProjectDirty = async (project: string): Promise<boolean> =>
  (await git(project, ...promotionStatusArgs)).length > 0;
