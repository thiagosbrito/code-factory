import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { RunRecord } from "../domain/run.js";
import { projectRelativePathSchema } from "../domain/evidence.js";
import { ProjectError } from "./project.js";

const exec = promisify(execFile);
const git = async (workspace: string, ...args: string[]) =>
  (await exec("git", ["-C", workspace, ...args], { encoding: "utf8", maxBuffer: 8_000_000 }))
    .stdout;

const workspaceFor = async (project: string, run: RunRecord) => {
  const relative = run.snapshot.baseline.workspace;
  if (!relative || !/^\.code-factory\/workspaces\/[0-9a-f-]{36}$/i.test(relative))
    throw new ProjectError("This run has no available isolated workspace.", 404);
  const projectRoot = await realpath(project);
  const root = await realpath(resolve(project, ".code-factory/workspaces"));
  if (!root.startsWith(`${projectRoot}${sep}`))
    throw new ProjectError("Workspace boundary violated.", 403);
  const workspace = await realpath(resolve(project, relative));
  if (!workspace.startsWith(`${root}${sep}`))
    throw new ProjectError("Workspace boundary violated.", 403);
  return workspace;
};

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
        "git",
        [
          "-C",
          workspace,
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
