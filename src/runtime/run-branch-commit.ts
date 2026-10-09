import { constants } from "node:fs";
import { copyFile, cp } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { RunRecord } from "../domain/run.js";
import { defaultTicketBranch, RUN_BRANCH_PREFIX, stepCommitMessage } from "../domain/run-branch.js";
import { fileDigest, gitCommonDir } from "./workspace.js";
import { type GitResult, identityArgs, runGit, git, tail, isCode } from "./run-branch-git.js";

export type StepCommit =
  | { kind: "committed"; sha: string; subject: string }
  | { kind: "unchanged" }
  | { kind: "failed"; exitCode: number | null; output: string; summary: string };

export const commitFailure = (result: GitResult): StepCommit => ({
  kind: "failed",
  exitCode: result.code,
  output: result.spawnError ? `Could not start git: ${result.spawnError}` : tail(result),
  summary: `Commit failed (exit ${result.code ?? "none"}); a Git hook or Git rejected the step's changes. See the commit-failed evidence.`,
});

/**
 * Commit a successful writing attempt on the run branch with the user's identity and hooks.
 * Failures are a result, never an exception, so the step fails instead of interrupting the run.
 */
export const commitStepChanges = async (
  workspace: string,
  record: RunRecord,
  stepId: string,
  attempt: { id: string; number: number; implementationRound: number },
): Promise<StepCommit> => {
  const branch = record.snapshot.baseline.branch ?? "";
  const head = await runGit(workspace, ["symbolic-ref", "--quiet", "HEAD"]);
  if (head.code === 0 || head.code === 1) {
    const ref = head.stdout.trim();
    if (head.code === 0 && ref === `refs/heads/${branch}`) {
      // On the run branch: continue below.
    } else {
      const shown =
        head.code === 0
          ? ref
          : `detached ${(await runGit(workspace, ["rev-parse", "HEAD"])).stdout.trim() || "unknown"}`;
      const reason = `The checkout is no longer on branch ${branch} (HEAD is ${shown}). Code Factory did not commit this step.`;
      return { kind: "failed", exitCode: null, output: reason, summary: reason };
    }
  } else return commitFailure(head);
  const added = await runGit(workspace, ["add", "--all", "--", ".", ":(exclude).code-factory"]);
  if (added.code !== 0) return commitFailure(added);
  const staged = await runGit(workspace, ["diff", "--cached", "--quiet"]);
  if (staged.code === 0) return { kind: "unchanged" };
  if (staged.code !== 1) return commitFailure(staged);
  const definition = record.snapshot.loop.steps.find((item) => item.id === stepId);
  const [subject, body] = stepCommitMessage({
    // Without a ticket, a branch the user named (say BMAP-9999) still labels the commit.
    ticketId:
      defaultTicketBranch(record.snapshot.task) ||
      (branch.startsWith(RUN_BRANCH_PREFIX) ? "" : branch),
    runId: record.snapshot.id,
    stepId,
    stepName: definition?.name || stepId,
    attemptId: attempt.id,
    attemptNumber: attempt.number,
    implementationRound: attempt.implementationRound,
  });
  const committed = await runGit(workspace, [
    ...identityArgs,
    "commit",
    "--quiet",
    "-m",
    subject,
    "-m",
    body,
  ]);
  if (committed.code !== 0) return commitFailure(committed);
  const sha = await runGit(workspace, ["rev-parse", "HEAD"]);
  if (sha.code !== 0) return commitFailure(sha);
  return { kind: "committed", sha: sha.stdout.trim(), subject };
};

/**
 * A frozen reviewer copy with private Git metadata: a shared clone without a remote, so a
 * reviewer that commits writes only to the temporary copy, never to the run branch.
 */
export const createReviewCopy = async (
  workspace: string,
  destination: string,
  candidateId: string,
): Promise<void> => {
  const common = await gitCommonDir(workspace);
  const tip = (await git(workspace, "rev-parse", "HEAD")).trim();
  await git(
    dirname(destination),
    "clone",
    "--quiet",
    "--shared",
    "--no-checkout",
    common,
    destination,
  );
  await git(destination, "remote", "remove", "origin");
  await git(destination, "update-ref", "--no-deref", "HEAD", tip);
  await git(destination, "read-tree", tip);
  const excludes = await runGit(workspace, ["config", "--get", "core.excludesFile"]);
  const excludesFile = excludes.stdout.trim();
  if (excludes.code === 0 && excludesFile) {
    const absolute = excludesFile.startsWith("~/")
      ? join(homedir(), excludesFile.slice(2))
      : resolve(workspace, excludesFile);
    await git(destination, "config", "core.excludesFile", absolute);
  }
  const ownGit = join(workspace, ".git");
  await cp(workspace, destination, {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
    filter: (source) => source !== ownGit,
  });
  await copyFile(
    join(common, "info", "exclude"),
    join(destination, ".git", "info", "exclude"),
  ).catch((error: unknown) => {
    if (!isCode(error, "ENOENT")) throw error;
  });
  if ((await fileDigest(destination, "git")) !== candidateId)
    throw new Error("Frozen review copy does not match the candidate.");
};
