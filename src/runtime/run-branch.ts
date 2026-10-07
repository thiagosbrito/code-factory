import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, cp, lstat, mkdir, readdir, realpath, rm, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Baseline, RunRecord } from "../domain/run.js";
import { runRecordSchema } from "../domain/run.js";
import { summarizeEvidence } from "../domain/acceptance.js";
import {
  appendRunEvent,
  baselineCommitMessage,
  defaultTicketBranch,
  promoteInputSchema,
  promotionBlocker,
  REMOVAL_DIRTY,
  RUN_BRANCH_PREFIX,
  shortRunBranch,
  stepCommitMessage,
  type RunWorkspace,
} from "../domain/run-branch.js";
import { ProjectError } from "./project.js";
import { mutateRun, readRun } from "./storage.js";
import {
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

const runGit = (
  cwd: string,
  args: readonly string[],
  timeout = COMMIT_TIMEOUT_MS,
): Promise<GitResult> =>
  new Promise((resolveGit) => {
    execFile(
      "git",
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

/** Serialize worktree and ref writes per repository against Git's shared locks. */
const repoLocks = new Map<string, Promise<unknown>>();
const withLock = async <T>(
  locks: Map<string, Promise<unknown>>,
  key: string,
  work: () => Promise<T>,
): Promise<T> => {
  const prior = locks.get(key) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(work);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
};
const withRepoLock = <T>(project: string, work: () => Promise<T>) =>
  withLock(repoLocks, project, work);
const promotionLocks = new Map<string, Promise<unknown>>();

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

const rejectEscapingLinks = async (workspace: string): Promise<void> => {
  const root = await realpath(workspace);
  const inspect = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (directory === workspace && entry.name === ".git") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await inspect(path);
      if (entry.isSymbolicLink()) {
        const target = await realpath(path).catch(() => null);
        if (!target || !target.startsWith(`${root}${sep}`))
          throw new Error(
            `Workspace link escapes the isolated project: ${relative(workspace, path)}`,
          );
      }
    }
  };
  await inspect(workspace);
};

/** Copy staged, unstaged and untracked paths and apply deletions, excluding `.code-factory`. */
const overlayUncommittedWork = async (
  project: string,
  workspace: string,
): Promise<{ changed: string[]; deleted: string[] }> => {
  const modified = await git(project, "ls-files", "-m", "-o", "--exclude-standard", "-z");
  const staged = await git(project, "diff", "--cached", "--name-only", "--no-renames", "-z");
  const changed = [
    ...new Set(
      `${modified}${staged}`
        .split("\0")
        .filter(Boolean)
        .filter((path) => path !== ".code-factory" && !path.startsWith(".code-factory/")),
    ),
  ];
  const deleted: string[] = [];
  for (const path of changed) {
    const source = join(project, path);
    const destination = join(workspace, path);
    const info = await lstat(source).catch((error: unknown) => {
      if (isCode(error, "ENOENT")) return null;
      throw error;
    });
    if (!info) {
      deleted.push(path);
      continue;
    }
    if (!info.isFile() && !info.isSymbolicLink())
      throw new Error(`Unsupported changed file: ${path}`);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { force: true });
  }
  for (const path of deleted) await rm(join(workspace, path), { force: true });
  return { changed: changed.filter((path) => !deleted.includes(path)), deleted };
};

/** Thrown when another call already claimed this run's worktree path (duplicate requestId). */
export class WorktreeExistsError extends Error {
  constructor(path: string) {
    super(`Run worktree already exists at ${path}.`);
  }
}

const branchExists = async (project: string, branch: string): Promise<boolean> =>
  (await runGit(project, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;

const removeWorktreeForcefully = async (project: string, path: string): Promise<void> => {
  await withRepoLock(project, async () => {
    const removed = await runGit(project, ["worktree", "remove", "--force", path]);
    if (removed.code !== 0) await rm(path, { recursive: true, force: true });
    await runGit(project, ["worktree", "prune"]);
  }).catch((error: unknown) => {
    console.error(
      "Run worktree rollback failed",
      path,
      error instanceof Error ? error.message : String(error),
    );
  });
};

/**
 * Create `<parent>/<repo>-code-factory/<runId>` as a detached worktree at HEAD, overlay the
 * user's uncommitted work, commit it as the baseline (hooks run), and attach the run branch last
 * so a failed creation never leaves a branch to roll back.
 */
export const createRunWorktree = async (
  project: string,
  options: { runId: string; ticketId: string },
): Promise<Baseline> => {
  const real = await realpath(project);
  const top = (await git(project, "rev-parse", "--show-toplevel")).trim();
  if (top !== real) throw new Error("The selected project must be the Git repository root.");
  const revision = (await git(project, "rev-parse", "HEAD")).trim();
  const before = await git(project, ...promotionStatusArgs);
  const { root, base } = await worktreeRootFor(project);
  const rootInfo = await lstat(root).catch((error: unknown) => {
    if (isCode(error, "ENOENT")) return null;
    throw error;
  });
  if (rootInfo && (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()))
    throw new Error(`${root} is not a directory Code Factory created.`);
  try {
    await mkdir(root, { recursive: true });
  } catch (error) {
    throw new Error(
      `Cannot create the run worktree folder ${root}: ${error instanceof Error && "code" in error ? String(error.code) : String(error)}`,
    );
  }
  const path = join(root, options.runId);
  try {
    await mkdir(path);
  } catch (error) {
    if (isCode(error, "EEXIST")) throw new WorktreeExistsError(path);
    throw new Error(
      `Cannot create the run worktree folder ${path}: ${error instanceof Error && "code" in error ? String(error.code) : String(error)}`,
    );
  }
  try {
    await withRepoLock(real, () =>
      git(real, "worktree", "add", "--quiet", "--detach", path, revision),
    );
    const { changed, deleted } = await overlayUncommittedWork(real, path);
    if (before !== (await git(project, ...promotionStatusArgs)))
      throw new Error("Project changed while capturing its baseline. Retry.");
    await rejectEscapingLinks(path);
    for (const variable of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) {
      const identity = await runGit(path, [...identityArgs, "var", variable]);
      if (identity.code !== 0)
        throw new Error(
          "Configure Git user.name and user.email for this repository. Code Factory never changes Git config.",
        );
    }
    await git(path, "add", "--all", "--", ".", ":(exclude).code-factory");
    const staged = await runGit(path, ["diff", "--cached", "--quiet"]);
    if (staged.code === 1) {
      const [subject, body] = baselineCommitMessage(options.ticketId, options.runId, new Date());
      const committed = await runGit(path, [
        ...identityArgs,
        "commit",
        "--quiet",
        "-m",
        subject,
        "-m",
        body,
      ]);
      if (committed.code !== 0)
        throw new Error(
          `baseline commit failed (exit ${committed.code ?? "none"}): ${tail(committed, 2000).trim()}`,
        );
    } else if (staged.code !== 0) throw new Error("Cannot inspect the baseline changes.");
    const branch = await withRepoLock(real, async () => {
      const preferred = shortRunBranch(options.runId);
      const fallback = `${RUN_BRANCH_PREFIX}${options.runId}`;
      const name = !(await branchExists(real, preferred))
        ? preferred
        : !(await branchExists(real, fallback))
          ? fallback
          : null;
      if (!name) throw new Error("Run branch already exists.");
      await git(path, "checkout", "--quiet", "-b", name);
      return name;
    });
    return {
      id: crypto.randomUUID(),
      kind: "git",
      revision: (await git(path, "rev-parse", "HEAD")).trim(),
      sourceRevision: revision,
      capturedAt: new Date().toISOString(),
      workspace: worktreeRelativePath(base, options.runId),
      branch,
      changes: [...new Set([...changed, ...deleted])].sort(),
    };
  } catch (error) {
    await removeWorktreeForcefully(real, path);
    throw error;
  }
};

/** Roll back a created worktree when the run record could not be stored. Branches are kept. */
export const discardRunWorktree = async (project: string, baseline: Baseline): Promise<void> => {
  const workspace = baseline.workspace;
  if (!workspace) return;
  if (workspace.startsWith(LEGACY_PREFIX)) {
    await rm(join(project, workspace), { recursive: true, force: true });
    return;
  }
  const { root, base } = await worktreeRootFor(project);
  const runId = workspace.split("/").at(-1) ?? "";
  if (workspace !== worktreeRelativePath(base, runId)) return;
  await removeWorktreeForcefully(await realpath(project), join(root, runId));
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
      const reason = `The worktree is no longer on branch ${branch} (HEAD is ${shown}). Code Factory did not commit this step.`;
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
    ticketId: defaultTicketBranch(record.snapshot.task),
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
  };
  const relativePath = record.snapshot.baseline.workspace;
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
    commits: log
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha = "", subject = ""] = line.split("\x1f");
        return { sha, subject };
      }),
  };
};

export class PromotionError extends ProjectError {
  constructor(
    message: string,
    status: number,
    readonly suggestedName?: string,
  ) {
    super(message, status);
  }
}

const validBranchName = async (project: string, name: string): Promise<boolean> => {
  const result = await runGit(project, ["check-ref-format", "--branch", name]);
  return result.code === 0 && result.stdout.trim() === name;
};

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
  return withLock(promotionLocks, `${project}:${runId}`, async () => {
    const current = await readRun(project, runId);
    if (!current) throw new PromotionError("Run not found.", 404);
    const workspace = await describeRunWorkspace(project, current);
    const present =
      workspace.kind === "worktree" && workspace.state === "present" && workspace.path
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
      throw new PromotionError(`The worktree is not on branch ${branch}.`, 409);
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
      if (existing.code === 0 && existing.stdout.trim() !== target) {
        let suggestion: string | undefined;
        for (let index = 2; index <= 20 && !suggestion; index += 1) {
          const candidate = `${name}-${index}`;
          if (
            (await validBranchName(project, candidate)) &&
            !(await branchExists(project, candidate))
          )
            suggestion = candidate;
        }
        return fail(`Branch ${name} already exists. Choose another name.`, suggestion);
      }
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
