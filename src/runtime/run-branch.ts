import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, cp, lstat, realpath, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Baseline, RunRecord } from "../domain/run.js";
import { runRecordSchema } from "../domain/run.js";
import { summarizeEvidence } from "../domain/acceptance.js";
import {
  appendRunEvent,
  defaultTicketBranch,
  isProjectRun,
  PROJECT_DIRTY,
  PROJECT_WORKSPACE,
  RUN_BRANCH_PREFIX,
  READ_ONLY_LEFTOVERS,
  READ_ONLY_VIOLATION,
  promoteInputSchema,
  promotionBlocker,
  REMOVAL_DIRTY,
  RETURN_DIRTY,
  stepCommitMessage,
  type ProjectCheckout,
  type RunWorkspace,
} from "../domain/run-branch.js";
import { createKeyedLock } from "./keyed-lock.js";
import { systemCommand } from "./launch-safety.js";
import { ProjectError } from "./project.js";
import { listRuns, mutateRun, readRun } from "./storage.js";
import {
  currentBranch,
  fileDigest,
  gitCommonDir,
  resolveRunWorkspace,
  worktreeRelativePath,
  worktreeRootFor,
} from "./workspace.js";

const OUTPUT_LIMIT = 8192;
const COMMIT_TIMEOUT_MS = 300_000;
// Every commit Code Factory makes refuses a hostname-derived identity (a per-command override,
// never a config write), so a missing user.name/user.email fails clearly.
const identityArgs = ["-c", "user.useConfigOnly=true"] as const;
const LEGACY_PREFIX = ".code-factory/workspaces/";
const TERMINAL = new Set(["succeeded", "failed", "canceled", "rejected", "blocked", "unavailable"]);

type GitResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
};

const runGit = async (
  cwd: string,
  args: readonly string[],
  timeout = COMMIT_TIMEOUT_MS,
): Promise<GitResult> => {
  let command: string;
  try {
    command = await systemCommand("git");
  } catch {
    return { code: null, stdout: "", stderr: "", timedOut: false, spawnError: "ENOENT" };
  }
  return new Promise((resolveGit) => {
    execFile(
      command,
      ["-C", cwd, ...args],
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => {
        if (!error) return resolveGit({ code: 0, stdout, stderr, timedOut: false });
        const code = "code" in error ? error.code : undefined;
        resolveGit({
          code: typeof code === "number" ? code : null,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          timedOut: error.killed === true && error.signal !== null,
          ...(typeof code === "string" ? { spawnError: code } : {}),
        });
      },
    );
  });
};

const firstLine = (text: string): string =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "unknown error";

const git = async (cwd: string, ...args: string[]): Promise<string> => {
  const result = await runGit(cwd, args);
  if (result.code !== 0)
    throw new Error(
      `git ${args.find((arg) => !arg.startsWith("-")) ?? ""} failed: ${result.spawnError ?? firstLine(`${result.stderr}\n${result.stdout}`)}`,
    );
  return result.stdout;
};

const tail = (result: GitResult, limit = OUTPUT_LIMIT): string => {
  const output = `${result.stdout}${result.stderr}`.slice(-limit);
  return result.timedOut ? `Timed out after ${COMMIT_TIMEOUT_MS / 1000} s\n${output}` : output;
};

const isCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

/** Serialize checkout, worktree and ref writes per repository against Git's shared locks. */
const withRepoLock = createKeyedLock();
const withPromotionLock = createKeyedLock();

/**
 * Every read-only status probe passes this global option. Without it `git status` refreshes the
 * index under `index.lock`, and a UI poll could then make a concurrent step commit fail.
 */
const NO_OPTIONAL_LOCKS = "--no-optional-locks";

const promotionStatusArgs = [
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

const branchExists = async (project: string, branch: string): Promise<boolean> =>
  (await runGit(project, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;

const validBranchName = async (project: string, name: string): Promise<boolean> => {
  const result = await runGit(project, ["check-ref-format", "--branch", name]);
  return result.code === 0 && result.stdout.trim() === name;
};

/** First free `<name>-<n>` so a refusal can offer a name instead of overwriting a branch. */
const suggestBranchName = async (project: string, name: string): Promise<string | undefined> => {
  for (let index = 2; index <= 20; index += 1) {
    const candidate = `${name}-${index}`;
    if ((await validBranchName(project, candidate)) && !(await branchExists(project, candidate)))
      return candidate;
  }
  return undefined;
};

export class BranchNameError extends ProjectError {
  constructor(
    message: string,
    status: number,
    readonly suggestedName?: string,
  ) {
    super(message, status);
  }
}

/** Git state files that mean a merge, rebase, cherry-pick, revert or bisect is in progress. */
const OPERATION_MARKERS = [
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "REBASE_HEAD",
  "rebase-merge",
  "rebase-apply",
  "BISECT_LOG",
] as const;

const operationInProgress = async (project: string): Promise<boolean> => {
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

const projectRoot = async (project: string): Promise<string> => {
  const real = await realpath(project);
  const top = await runGit(real, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0 || (await realpath(top.stdout.trim()).catch(() => null)) !== real)
    throw new ProjectError("The selected project must be the root of a Git repository.", 422);
  return real;
};

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

const ensureCommitIdentity = async (project: string): Promise<void> => {
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

const switchBack = (
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

const holdsProject = (record: RunRecord): boolean =>
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
const hasUnresolvedReadOnlyViolation = (record: RunRecord): boolean => {
  const violation = [...record.evidence]
    .reverse()
    .find((item) => item.kind === "event" && item.title === READ_ONLY_VIOLATION);
  if (!violation) return false;
  return !record.steps.some((step) =>
    step.attempts.some((attempt) => attempt.startedAt > violation.createdAt),
  );
};

const describeCheckout = async (project: string, record: RunRecord): Promise<ProjectCheckout> => {
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

export type StepCommit =
  | { kind: "committed"; sha: string; subject: string }
  | { kind: "unchanged" }
  | { kind: "failed"; exitCode: number | null; output: string; summary: string };

const commitFailure = (result: GitResult): StepCommit => ({
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

const projectRunPath = async (project: string, record: RunRecord): Promise<string | null> => {
  const workspace = record.snapshot.baseline.workspace ?? "";
  const { root, base } = await worktreeRootFor(project);
  const runId = workspace.split("/").at(-1) ?? "";
  return workspace === worktreeRelativePath(base, runId) ? join(root, runId) : null;
};

const parseLog = (log: string) =>
  log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha = "", subject = ""] = line.split("\x1f");
      return { sha, subject };
    });

/** Branch, path, state, dirty rules and commit list for the run detail. Never computes a digest. */
export const describeRunWorkspace = async (
  project: string,
  record: RunRecord,
): Promise<RunWorkspace> => {
  const common = {
    branch: record.snapshot.baseline.branch ?? null,
    promotion: record.promotion ?? null,
    defaultBranchName: defaultTicketBranch(record.snapshot.task),
    setupConfigured: Boolean(record.snapshot.setupCommand),
    dirty: null,
    removalBlocked: null,
    commits: [],
    checkout: null,
  };
  const relativePath = record.snapshot.baseline.workspace;
  if (isProjectRun(record.snapshot.baseline)) {
    const real = await realpath(project);
    const branch = common.branch ?? "";
    const tip = await runGit(real, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    const checkout = await describeCheckout(real, record);
    const source = record.snapshot.baseline.sourceRevision;
    const log =
      tip.code === 0
        ? await git(
            real,
            "log",
            source ? `${source}..refs/heads/${branch}` : `refs/heads/${branch}`,
            "--format=%H%x1f%s",
            "-n",
            "100",
          )
        : "";
    return {
      ...common,
      kind: "project",
      path: real,
      state: tip.code === 0 ? "present" : "missing",
      dirty: checkout.onRunBranch ? await isPromotionDirty(real) : null,
      commits: parseLog(log),
      checkout,
    };
  }
  if (!relativePath) return { ...common, kind: "none", path: null, state: "missing" };
  if (relativePath.startsWith(LEGACY_PREFIX)) {
    const resolved = await resolveRunWorkspace(project, record, { legacy: "prefix" }).catch(
      (error: unknown) => {
        if (error instanceof ProjectError && error.status === 404) return null;
        throw error;
      },
    );
    return {
      ...common,
      kind: "clone",
      path: resolved?.path ?? null,
      state: resolved ? "present" : "missing",
    };
  }
  const expected = await projectRunPath(project, record);
  if (record.worktree) return { ...common, kind: "worktree", path: expected, state: "removed" };
  const resolved = await resolveRunWorkspace(project, record, { legacy: "prefix" }).catch(
    (error: unknown) => {
      if (error instanceof ProjectError && error.status === 404) return null;
      throw error;
    },
  );
  if (!resolved) return { ...common, kind: "worktree", path: expected, state: "missing" };
  const range = record.snapshot.baseline.sourceRevision
    ? [`${record.snapshot.baseline.sourceRevision}..HEAD`]
    : ["HEAD"];
  const log = await git(resolved.path, "log", ...range, "--format=%H%x1f%s", "-n", "100");
  return {
    ...common,
    kind: "worktree",
    path: resolved.path,
    state: "present",
    dirty: await isPromotionDirty(resolved.path),
    removalBlocked: await isRemovalBlockedByChanges(resolved.path),
    commits: parseLog(log),
  };
};

/** Promotion refusals carry an optional free name, like a refused run branch. */
export class PromotionError extends BranchNameError {}

const appendEvent = (
  project: string,
  runId: string,
  title: string,
  detail: string,
  state?: string,
): Promise<RunRecord> =>
  mutateRun(project, runId, (current) =>
    appendRunEvent(current, "lifecycle", title, detail, state),
  );

/**
 * Create a ticket branch at the accepted run branch tip. Create-only (`update-ref <ref> <sha> ""`),
 * so an existing branch is never overwritten; nothing is pushed and no remote is touched.
 */
export const promoteRun = async (
  project: string,
  runId: string,
  input: unknown,
): Promise<{ run: RunRecord; warning?: string }> => {
  const parsed = promoteInputSchema.safeParse(input);
  if (!parsed.success)
    throw new PromotionError(parsed.error.issues[0]?.message ?? "Enter a branch name.", 400);
  const name = parsed.data.branch;
  if (!(await validBranchName(project, name)))
    throw new PromotionError(`${name} is not a valid branch name.`, 400);
  return withPromotionLock(`${project}:${runId}`, async () => {
    const current = await readRun(project, runId);
    if (!current) throw new PromotionError("Run not found.", 404);
    const workspace = await describeRunWorkspace(project, current);
    const present =
      (workspace.kind === "worktree" ||
        (workspace.kind === "project" && workspace.checkout?.onRunBranch)) &&
      workspace.state === "present" &&
      workspace.path
        ? workspace.path
        : null;
    // Read the tip before the acceptance checks so a commit landing during them is refused below.
    const target = present ? (await git(present, "rev-parse", "HEAD")).trim() : null;
    const digest = present ? await fileDigest(present, "git") : null;
    const blocker = promotionBlocker(summarizeEvidence(current, digest), workspace);
    if (blocker || !present || !digest || !target)
      throw new PromotionError(blocker ?? "Run worktree is unavailable.", 409);
    const path = present;
    const branch = current.snapshot.baseline.branch ?? "";
    const head = await runGit(path, ["symbolic-ref", "--quiet", "HEAD"]);
    if (head.code !== 0 || head.stdout.trim() !== `refs/heads/${branch}`)
      throw new PromotionError(`The run's checkout is not on branch ${branch}.`, 409);
    if ((await git(path, "rev-parse", "HEAD")).trim() !== target)
      throw new PromotionError(
        "The run branch moved while Code Factory checked it. Wait for the run to settle and retry.",
        409,
      );
    await appendEvent(project, runId, "ticket-branch-requested", `${name} → ${target}`);
    const fail = async (message: string, suggestedName?: string): Promise<never> => {
      await appendEvent(project, runId, "ticket-branch-failed", message, "failed");
      throw new PromotionError(message, 409, suggestedName);
    };
    const created = await withRepoLock(await realpath(project), () =>
      runGit(project, [
        "update-ref",
        "-m",
        `code-factory: promote run ${runId}`,
        `refs/heads/${name}`,
        target,
        "",
      ]),
    );
    if (created.code !== 0) {
      const existing = await runGit(project, [
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${name}`,
      ]);
      if (existing.code === 0 && existing.stdout.trim() !== target)
        return fail(
          `Branch ${name} already exists. Choose another name.`,
          await suggestBranchName(project, name),
        );
      if (existing.code !== 0)
        return fail(`Cannot create branch ${name}: ${firstLine(created.stderr)}`);
      // The ref already points at the accepted commit (crash before the record write): adopt it.
    }
    const changed =
      (await fileDigest(path, "git").catch(() => null)) !== digest ||
      (await runGit(path, ["rev-parse", "HEAD"])).stdout.trim() !== target;
    const run = await mutateRun(project, runId, (latest) =>
      appendRunEvent(
        runRecordSchema.parse({
          ...latest,
          promotion: { branch: name, commit: target, createdAt: new Date().toISOString() },
        }),
        "lifecycle",
        "ticket-branch-created",
        `${name} → ${target}`,
        "succeeded",
      ),
    );
    return changed
      ? {
          run,
          warning: `The worktree changed while the branch was being created; ${name} points at the accepted commit ${target.slice(0, 7)}.`,
        }
      : { run };
  });
};

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
