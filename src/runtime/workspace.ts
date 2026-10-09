import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { RunRecord } from "../domain/run.js";
import {
  checkoutMovedMessage,
  isProjectRun,
  missingWorktreeMessage,
  removedWorktreeMessage,
} from "../domain/run-branch.js";
import { systemCommand } from "./launch-safety.js";
import { ProjectError } from "./project.js";

const exec = promisify(execFile);
/** Read-only probes never take optional locks, so polling cannot race a step commit. */
const readGit = async (directory: string, ...args: string[]): Promise<string> =>
  (
    await exec(await systemCommand("git"), ["-C", directory, "--no-optional-locks", ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
  ).stdout;

export type DigestMode = "walk" | "git";
export type ResolvedWorkspace = {
  path: string;
  kind: "project" | "worktree" | "clone";
  digestMode: DigestMode;
};

const LEGACY_PREFIX = ".code-factory/workspaces/";
const UUID = /^[0-9a-f-]{36}$/i;

const isCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

/** The checked-out branch, or null on a detached HEAD. */
export const currentBranch = async (directory: string): Promise<string | null> => {
  try {
    return (await readGit(directory, "symbolic-ref", "--quiet", "--short", "HEAD")).trim() || null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 1) return null;
    throw error;
  }
};

/**
 * An in-project run works in the repository root itself, and only while the checkout is on its
 * run branch: a user who switched away gets a clear 409 instead of a run on the wrong files.
 */
const resolveProject = async (project: string, record: RunRecord): Promise<string> => {
  const real = await realpath(project);
  const top = await readGit(real, "rev-parse", "--show-toplevel").then(
    (output) => realpath(output.trim()),
    () => null,
  );
  if (top !== real)
    throw new ProjectError("The project is no longer the root of a Git repository.", 404);
  const branch = record.snapshot.baseline.branch ?? "";
  const current = await currentBranch(real);
  if (current !== branch) throw new ProjectError(checkoutMovedMessage(branch, current), 409);
  return real;
};

/** Legacy clone runs keep today's walk digest so their stored candidate IDs stay valid. */
export const digestModeFor = (record: RunRecord): DigestMode =>
  (record.snapshot.baseline.workspace ?? "").startsWith(LEGACY_PREFIX) ? "walk" : "git";

/** `git rev-parse --git-common-dir` may print a path relative to `dir`, so resolve it there. */
export const gitCommonDir = async (directory: string): Promise<string> =>
  realpath(resolve(directory, (await readGit(directory, "rev-parse", "--git-common-dir")).trim()));

/** Sibling folder that holds every run worktree of a project: `<parent>/<repo>-code-factory`. */
export const worktreeRootFor = async (project: string): Promise<{ root: string; base: string }> => {
  const real = await realpath(project);
  const base = basename(real);
  return { root: join(dirname(real), `${base}-code-factory`), base };
};

export const worktreeRelativePath = (base: string, runId: string): string =>
  `../${base}-code-factory/${runId}`;

const resolveWorktree = async (project: string, record: RunRecord): Promise<string> => {
  const relativePath = record.snapshot.baseline.workspace ?? "";
  const branch = record.snapshot.baseline.branch ?? "";
  const { root, base } = await worktreeRootFor(project);
  const runId = relativePath.split("/").at(-1) ?? "";
  if (relativePath !== worktreeRelativePath(base, runId) || !UUID.test(runId))
    throw new ProjectError("This run has no available isolated workspace.", 404);
  if (record.worktree) throw new ProjectError(removedWorktreeMessage(branch), 404);
  const target = join(root, runId);
  const rootInfo = await lstat(root).catch((error: unknown) => {
    if (isCode(error, "ENOENT")) return null;
    throw error;
  });
  if (!rootInfo) throw new ProjectError(missingWorktreeMessage(target, branch), 404);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
    throw new ProjectError("Workspace boundary violated.", 403);
  const realRoot = await realpath(root);
  if (dirname(realRoot) !== dirname(await realpath(project)))
    throw new ProjectError("Workspace boundary violated.", 403);
  const workspace = await realpath(target).catch((error: unknown) => {
    if (isCode(error, "ENOENT")) return null;
    throw error;
  });
  if (!workspace) throw new ProjectError(missingWorktreeMessage(target, branch), 404);
  if (!workspace.startsWith(`${realRoot}${sep}`))
    throw new ProjectError("Workspace boundary violated.", 403);
  const dotGit = await lstat(join(workspace, ".git")).catch(() => null);
  if (!dotGit?.isFile()) throw new ProjectError("Workspace boundary violated.", 403);
  const [own, expected] = await Promise.all([
    gitCommonDir(workspace).catch(() => null),
    gitCommonDir(project).catch(() => null),
  ]);
  if (!own || own !== expected) throw new ProjectError("Workspace boundary violated.", 403);
  return workspace;
};

/**
 * One owner for run workspace path rules. Worktree runs live beside the repository; legacy
 * clones stay under `.code-factory/workspaces/` with the scheduler's prefix rule or
 * inspection's strict UUID rule.
 */
export const resolveRunWorkspace = async (
  project: string,
  record: RunRecord,
  options: { legacy: "prefix" | "uuid" },
): Promise<ResolvedWorkspace> => {
  const relativePath = record.snapshot.baseline.workspace;
  if (!relativePath) throw new ProjectError("This run has no available isolated workspace.", 404);
  if (isProjectRun(record.snapshot.baseline))
    return { path: await resolveProject(project, record), kind: "project", digestMode: "git" };
  if (!relativePath.startsWith(LEGACY_PREFIX))
    return { path: await resolveWorktree(project, record), kind: "worktree", digestMode: "git" };
  if (options.legacy === "uuid" && !UUID.test(relativePath.slice(LEGACY_PREFIX.length)))
    throw new ProjectError("This run has no available isolated workspace.", 404);
  const projectRoot = await realpath(project);
  const root = await realpath(resolve(project, ".code-factory/workspaces")).catch(() => null);
  if (!root) throw new ProjectError("This run has no available isolated workspace.", 404);
  if (!root.startsWith(`${projectRoot}${sep}`))
    throw new ProjectError("Workspace boundary violated.", 403);
  const workspace = await realpath(resolve(project, relativePath)).catch(() => null);
  if (!workspace) throw new ProjectError("This run has no available isolated workspace.", 404);
  if (!workspace.startsWith(`${root}${sep}`))
    throw new ProjectError("Workspace boundary violated.", 403);
  return { path: workspace, kind: "clone", digestMode: "walk" };
};

const walkDigest = async (directory: string): Promise<string> => {
  const hash = createHash("sha256");
  const visit = async (folder: string, prefix: string): Promise<void> => {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name === ".git" || entry.name === ".code-factory") continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(folder, entry.name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) {
        hash.update(`link:${relativePath}:${await readlink(path)}`);
      } else if (stats.isDirectory()) {
        await visit(path, relativePath);
      } else if (stats.isFile()) {
        hash.update(`file:${relativePath}:`);
        hash.update(await readFile(path));
      }
    }
  };
  await visit(directory, "");
  return hash.digest("hex");
};

/**
 * Git mode hashes what would be committed: tracked plus non-ignored untracked files. The same
 * pass keeps a per-path hash so a read-only step can report exactly which files it changed.
 */
export const gitTreeState = async (
  directory: string,
): Promise<{ digest: string; files: Map<string, string> }> => {
  const listed = (
    await readGit(directory, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
  )
    .split("\0")
    .filter(Boolean)
    .filter((path) => path !== ".code-factory" && !path.startsWith(".code-factory/"));
  const paths = [...new Set(listed)].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const hash = createHash("sha256");
  const files = new Map<string, string>();
  for (const path of paths) {
    const absolute = join(directory, path);
    const stats = await lstat(absolute).catch((error: unknown) => {
      if (isCode(error, "ENOENT")) return null;
      throw error;
    });
    if (!stats || stats.isDirectory()) continue;
    if (stats.isSymbolicLink()) {
      const entry = `link:${path}:${await readlink(absolute)}`;
      hash.update(entry);
      files.set(path, createHash("sha256").update(entry).digest("hex"));
    } else if (stats.isFile()) {
      // Git records only the executable bit, so a chmod +x is a new candidate too.
      const header = `file:${path}:${stats.mode & 0o111 ? "755" : "644"}:`;
      const content = await readFile(absolute);
      hash.update(header);
      hash.update(content);
      files.set(path, createHash("sha256").update(header).update(content).digest("hex"));
    }
  }
  return { digest: hash.digest("hex"), files };
};

const gitDigest = async (directory: string): Promise<string> =>
  (await gitTreeState(directory)).digest;

export const fileDigest = async (directory: string, mode: DigestMode = "walk"): Promise<string> =>
  mode === "git" ? gitDigest(directory) : walkDigest(directory);
