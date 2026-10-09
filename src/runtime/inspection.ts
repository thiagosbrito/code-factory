import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { RunRecord } from "../domain/run.js";
import { projectRelativePathSchema } from "../domain/evidence.js";
import { systemCommand } from "./launch-safety.js";
import { ProjectError } from "./project.js";
import { resolveRunWorkspace } from "./workspace.js";

const exec = promisify(execFile);
/**
 * Inspection only reads, but porcelain `git diff` against the working tree refreshes and rewrites
 * the index under `index.lock` even with `--no-optional-locks` (Git 2.50). While the UI polls,
 * that would race a step commit in the same worktree. Diffs therefore run against a private copy
 * of the index, so any refresh lands in the copy. Other read commands never write the index.
 */
// A workspace's index path never changes, so resolve it once instead of spawning Git per diff.
const indexPaths = new Map<string, Promise<string>>();
const indexPathOf = (workspace: string): Promise<string> => {
  const cached = indexPaths.get(workspace);
  if (cached) return cached;
  const pending = systemCommand("git")
    .then((git) =>
      exec(git, ["-C", workspace, "rev-parse", "--git-path", "index"], { encoding: "utf8" }),
    )
    .then((result) => resolve(workspace, result.stdout.trim()));
  // A failed lookup is not cached, so a later call can succeed once the workspace exists.
  pending.catch(() => indexPaths.delete(workspace));
  indexPaths.set(workspace, pending);
  return pending;
};

const git = async (workspace: string, ...args: string[]): Promise<string> => {
  const run = async (env: NodeJS.ProcessEnv) =>
    exec(await systemCommand("git"), ["-C", workspace, "--no-optional-locks", ...args], {
      encoding: "utf8",
      maxBuffer: 8_000_000,
      env,
    }).then((result) => result.stdout);
  if (args[0] !== "diff") return run(process.env);
  const index = await indexPathOf(workspace);
  const directory = await mkdtemp(join(tmpdir(), "code-factory-index-"));
  try {
    const copy = join(directory, "index");
    const copied = await copyFile(index, copy).then(
      () => true,
      (error: unknown) => {
        // No index file yet: there is nothing a refresh could race, so use Git's default.
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
        throw error;
      },
    );
    return await run(copied ? { ...process.env, GIT_INDEX_FILE: copy } : process.env);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const workspaceFor = async (project: string, run: RunRecord) =>
  (await resolveRunWorkspace(project, run, { legacy: "uuid" })).path;

const safeFile = async (workspace: string, path: string) => {
  if (
    !projectRelativePathSchema.safeParse(path).success ||
    path.split("/")[0] === ".git" ||
    path.split("/")[0] === ".code-factory"
  )
    throw new ProjectError("Invalid project-relative path.", 400);
  const candidate = resolve(workspace, path);
  if (!candidate.startsWith(`${workspace}${sep}`))
    throw new ProjectError("Path escapes workspace.", 403);
  const parts = path.split("/");
  let current = workspace;
  for (const part of parts) {
    current = resolve(current, part);
    const stat = await lstat(current).catch(() => null);
    if (!stat) throw new ProjectError("Output is missing from the workspace.", 404);
    if (stat.isSymbolicLink()) throw new ProjectError("Linked outputs cannot be inspected.", 403);
  }
  if (!(await lstat(candidate)).isFile())
    throw new ProjectError("Output is not a regular file.", 422);
  return candidate;
};

export type InspectedChange = {
  path: string;
  previousPath?: string;
  change: "added" | "modified" | "deleted" | "renamed";
  attribution: "recorded" | "uncertain";
  receiptId?: string;
  stepId?: string;
  attemptId?: string;
  createdAt?: string;
  candidateId?: string;
  freshness?: string;
};

const digestDiff = (diff: string) => createHash("sha256").update(diff).digest("hex");

const changesBetween = async (
  workspace: string,
  from: string,
  to?: string,
): Promise<InspectedChange[]> => {
  const output = await git(
    workspace,
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--name-status",
    "-z",
    "--find-renames",
    from,
    ...(to ? [to] : []),
    "--",
    ".",
    ":(exclude).code-factory",
  );
  const parts = output.split("\0");
  const changes: InspectedChange[] = [];
  for (let index = 0; index < parts.length - 1;) {
    const status = parts[index++] ?? "";
    const previous = parts[index++] ?? "";
    if (!status || !previous) break;
    const renamed = status.startsWith("R");
    const path = renamed ? (parts[index++] ?? "") : previous;
    changes.push({
      path,
      ...(renamed ? { previousPath: previous } : {}),
      change: renamed
        ? "renamed"
        : status === "A"
          ? "added"
          : status === "D"
            ? "deleted"
            : "modified",
      attribution: "uncertain",
    });
  }
  return changes;
};

export const inspectFiles = async (project: string, run: RunRecord) => {
  const workspace = await workspaceFor(project, run);
  const baseline = run.snapshot.baseline;
  if (!baseline.revision) throw new ProjectError("This run has no Git baseline.", 404);
  const baselineRevision = baseline.revision;
  const changes = await changesBetween(workspace, baselineRevision);
  const untracked = (await git(workspace, "ls-files", "--others", "--exclude-standard", "-z"))
    .split("\0")
    .filter(Boolean)
    .filter((path) => path !== ".code-factory" && !path.startsWith(".code-factory/"));
  for (const path of untracked) changes.push({ path, change: "added", attribution: "uncertain" });
  const files = await Promise.all(
    changes.map(async (change) => {
      const receipt = [...run.evidence]
        .reverse()
        .find((item) => item.kind === "file" && item.path === change.path);
      if (receipt?.kind !== "file" || receipt.change !== change.change) return change;
      const diff = await (async () => {
        if (change.change !== "deleted") await safeFile(workspace, change.path);
        return diffForChange(workspace, baselineRevision, change);
      })().catch(() => null);
      return diff && receipt.diffDigest === digestDiff(diff)
        ? {
            ...change,
            attribution: "recorded" as const,
            receiptId: receipt.id,
            stepId: receipt.stepId,
            attemptId: receipt.attemptId,
            createdAt: receipt.createdAt,
            candidateId: receipt.provenance.candidateId,
            freshness: receipt.freshness.state,
          }
        : change;
    }),
  );
  const preExisting =
    baseline.sourceRevision && baseline.sourceRevision !== baseline.revision
      ? await changesBetween(workspace, baseline.sourceRevision, baseline.revision)
      : [];
  return { baselineRevision, files, preExisting };
};

export const inspectDiff = async (project: string, run: RunRecord, path: string) => {
  const workspace = await workspaceFor(project, run);
  const inspected = await inspectFiles(project, run);
  const change = inspected.files.find((item) => item.path === path);
  if (!change) throw new ProjectError("This path is not a task change.", 404);
  if (change.change !== "deleted") await safeFile(workspace, path);
  const diff = await diffForChange(workspace, inspected.baselineRevision, change);
  return { path, diff, change };
};

const diffForChange = async (
  workspace: string,
  baselineRevision: string,
  change: InspectedChange,
) =>
  change.change === "added" && !(await git(workspace, "ls-files", "--", change.path)).trim()
    ? await exec(
        await systemCommand("git"),
        [
          "-C",
          workspace,
          "--no-optional-locks",
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-index",
          "--",
          "/dev/null",
          change.path,
        ],
        {
          encoding: "utf8",
          maxBuffer: 8_000_000,
        },
      ).then(
        (result) => result.stdout,
        (error: unknown) =>
          error &&
          typeof error === "object" &&
          "stdout" in error &&
          typeof error.stdout === "string"
            ? error.stdout
            : Promise.reject(error),
      )
    : await git(
        workspace,
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        baselineRevision,
        "--",
        ...(change.previousPath ? [change.previousPath] : []),
        change.path,
      );

export const snapshotFileDiffs = async (project: string, run: RunRecord) => {
  const workspace = await workspaceFor(project, run);
  const { baselineRevision, files } = await inspectFiles(project, run);
  const snapshots = await Promise.all(
    files.map(async (change) => {
      try {
        if (change.change !== "deleted") await safeFile(workspace, change.path);
        const diff = await diffForChange(workspace, baselineRevision, change);
        return { change, diff, digest: digestDiff(diff) };
      } catch {
        return null;
      }
    }),
  );
  return snapshots.filter((item): item is NonNullable<typeof item> => item !== null);
};

export const inspectArtifact = async (project: string, run: RunRecord, id: string) => {
  const receipt = run.evidence.find((item) => item.kind === "artifact" && item.id === id);
  if (!receipt || receipt.kind !== "artifact")
    throw new ProjectError("Declared artifact not found.", 404);
  const workspace = await workspaceFor(project, run);
  const path = await safeFile(workspace, receipt.relativePath);
  const stat = await lstat(path);
  if (stat.size > 5_000_000) throw new ProjectError("Artifact is too large to inspect.", 413);
  const bytes = await readFile(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== receipt.digest)
    throw new ProjectError("Artifact has changed since its receipt was recorded.", 409);
  const kind = receipt.mediaType.split(";")[0]?.toLowerCase();
  const signatures: Record<string, (bytes: Buffer) => boolean> = {
    "image/png": (value) =>
      value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/jpeg": (value) => value[0] === 255 && value[1] === 216 && value[2] === 255,
    "image/gif": (value) => value.subarray(0, 4).toString("ascii") === "GIF8",
    "image/webp": (value) =>
      value.subarray(0, 4).toString("ascii") === "RIFF" &&
      value.subarray(8, 12).toString("ascii") === "WEBP",
  };
  if (kind && kind in signatures && !signatures[kind]?.(bytes))
    throw new ProjectError("Artifact image content does not match its declared type.", 422);
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:\s*;\s*charset=[a-z0-9-]+)?$/i.test(receipt.mediaType))
    throw new ProjectError("Artifact content type is invalid.", 422);
  return { name: receipt.name, mediaType: receipt.mediaType, base64: bytes.toString("base64") };
};
