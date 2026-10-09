import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { Baseline, RunRecord } from "../domain/run.js";
import {
  appendRunEvent,
  isProjectRun,
  PROJECT_DIRTY,
  PROJECT_WORKSPACE,
  RETURN_DIRTY,
  type ProjectCheckout,
} from "../domain/run-branch.js";
import { ProjectError } from "./project.js";
import { mutateRun, readRun } from "./storage.js";
import { currentBranch } from "./workspace.js";
import {
  TERMINAL,
  identityArgs,
  runGit,
  firstLine,
  git,
  isCode,
  withRepoLock,
} from "./run-branch-git.js";
import { isProjectDirty } from "./run-branch-status.js";
import {
  branchExists,
  validBranchName,
  suggestBranchName,
  BranchNameError,
} from "./run-branch-names.js";

/** Git state files that mean a merge, rebase, cherry-pick, revert or bisect is in progress. */
export const OPERATION_MARKERS = [
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "REBASE_HEAD",
  "rebase-merge",
  "rebase-apply",
  "BISECT_LOG",
] as const;

export const operationInProgress = async (project: string): Promise<boolean> => {
  for (const marker of OPERATION_MARKERS) {
    const path = (await git(project, "rev-parse", "--git-path", marker)).trim();
    const found = await lstat(resolve(project, path)).catch((error: unknown) => {
      if (isCode(error, "ENOENT")) return null;
      throw error;
    });
    if (found) return true;
  }
  return false;
};

export const projectRoot = async (project: string): Promise<string> => {
  const real = await realpath(project);
  const top = await runGit(real, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0 || (await realpath(top.stdout.trim()).catch(() => null)) !== real)
    throw new ProjectError("The selected project must be the root of a Git repository.", 422);
  return real;
};

export const ensureCommitIdentity = async (project: string): Promise<void> => {
  for (const variable of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) {
    const identity = await runGit(project, [...identityArgs, "var", variable]);
    if (identity.code !== 0)
      throw new ProjectError(
        "Configure Git user.name and user.email for this repository. Code Factory never changes Git config.",
        422,
      );
  }
};

/**
 * Start an in-project run: refuse a dirty tree or an operation in progress, then create the run
 * branch at HEAD and switch the checkout to it. `git switch -c` refuses an existing name, so a
 * branch is never overwritten, and a clean tree means no file changes during the switch.
 */
export const createProjectRunBranch = async (
  project: string,
  options: { branch: string },
): Promise<Baseline> => {
  const real = await projectRoot(project);
  return withRepoLock(real, async () => {
    const head = await runGit(real, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
    if (head.code !== 0)
      throw new ProjectError(
        "The project has no commits yet. Make a first commit, then start the run.",
        422,
      );
    const revision = head.stdout.trim();
    if (await operationInProgress(real))
      throw new ProjectError(
        "A merge, rebase, cherry-pick, revert or bisect is in progress in the project. Finish or abort it first.",
        409,
      );
    if (await isProjectDirty(real)) throw new ProjectError(PROJECT_DIRTY, 409);
    await ensureCommitIdentity(real);
    const name = options.branch;
    if (!(await validBranchName(real, name)))
      throw new BranchNameError(`${name} is not a valid branch name.`, 400);
    if (await branchExists(real, name))
      throw new BranchNameError(
        `Branch ${name} already exists. Choose another name; Code Factory never reuses or overwrites a branch.`,
        409,
        await suggestBranchName(real, name),
      );
    const previousBranch = await currentBranch(real);
    const switched = await runGit(real, ["switch", "--quiet", "-c", name]);
    if (switched.code !== 0)
      throw new ProjectError(
        `Cannot create branch ${name}: ${switched.spawnError ?? firstLine(`${switched.stderr}\n${switched.stdout}`)}`,
        409,
      );
    return {
      id: crypto.randomUUID(),
      kind: "git",
      revision,
      sourceRevision: revision,
      capturedAt: new Date().toISOString(),
      workspace: PROJECT_WORKSPACE,
      branch: name,
      checkout: { previousBranch, previousRevision: revision },
      changes: [],
    };
  });
};

export const switchBack = (
  project: string,
  checkout: { previousBranch: string | null; previousRevision: string },
) =>
  runGit(
    project,
    checkout.previousBranch
      ? ["switch", "--quiet", checkout.previousBranch]
      : ["switch", "--quiet", "--detach", checkout.previousRevision],
  );

/**
 * Undo a just-created run branch when its record could not be stored: switch back (no force) and
 * delete the branch only while it still points at its start commit. Failures are logged and leave
 * the branch in place.
 */
export const rollbackProjectRunBranch = async (
  project: string,
  baseline: Baseline,
): Promise<void> => {
  const { branch, checkout, revision } = baseline;
  if (!isProjectRun(baseline) || !branch || !checkout || !revision) return;
  const real = await realpath(project);
  await withRepoLock(real, async () => {
    if ((await currentBranch(real)) !== branch) return;
    const back = await switchBack(real, checkout);
    if (back.code !== 0) throw new Error(firstLine(`${back.stderr}\n${back.stdout}`));
    await git(real, "update-ref", "-d", `refs/heads/${branch}`, revision);
  }).catch((error: unknown) => {
    console.error(
      "Run branch rollback failed",
      branch,
      error instanceof Error ? error.message : String(error),
    );
  });
};

export const describeCheckout = async (
  project: string,
  record: RunRecord,
): Promise<ProjectCheckout> => {
  const branch = record.snapshot.baseline.branch ?? "";
  const checkout = record.snapshot.baseline.checkout;
  const previousBranch = checkout?.previousBranch ?? null;
  const previousRevision = checkout?.previousRevision ?? "";
  const current = await currentBranch(project);
  const onRunBranch = current === branch;
  const target = previousBranch ?? `${previousRevision.slice(0, 7)} (detached)`;
  const returnBlocker = !TERMINAL.has(record.status)
    ? `Finish or cancel the run before switching back to ${target}.`
    : !onRunBranch
      ? `The project is no longer on ${branch}.`
      : (await isProjectDirty(project))
        ? RETURN_DIRTY
        : previousBranch && !(await branchExists(project, previousBranch))
          ? `Branch ${previousBranch} no longer exists.`
          : null;
  return { current, onRunBranch, previousBranch, previousRevision, returnBlocker };
};

/**
 * "Back to <previous branch>": a plain `git switch` (never forced) from the run branch to the
 * branch the checkout was on when the run started. Refused while the run is active, when the
 * checkout moved, or with any uncommitted change, so nothing is stashed, reset or overwritten.
 */
export const returnToPreviousBranch = async (
  project: string,
  runId: string,
): Promise<RunRecord> => {
  const real = await realpath(project);
  const record = await readRun(project, runId);
  if (!record) throw new ProjectError("Run not found.", 404);
  const checkout = record.snapshot.baseline.checkout;
  if (!isProjectRun(record.snapshot.baseline) || !checkout)
    throw new ProjectError("This run did not switch the project checkout.", 409);
  const target = await withRepoLock(real, async () => {
    const state = await describeCheckout(real, record);
    if (state.returnBlocker) throw new ProjectError(state.returnBlocker, 409);
    const back = await switchBack(real, checkout);
    if (back.code !== 0)
      throw new ProjectError(
        `Git refused to switch branches: ${back.spawnError ?? firstLine(`${back.stderr}\n${back.stdout}`)}`,
        409,
      );
    return checkout.previousBranch ?? checkout.previousRevision;
  });
  return mutateRun(project, runId, (current) =>
    appendRunEvent(
      current,
      "lifecycle",
      "checkout-returned",
      `${record.snapshot.baseline.branch ?? ""} → ${target}`,
      "succeeded",
    ),
  );
};
