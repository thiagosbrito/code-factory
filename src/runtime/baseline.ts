import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { cp, lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { Baseline } from "../domain/run.js";

const run = promisify(execFile);

const git = async (project: string, ...args: string[]): Promise<string> => {
  const { stdout } = await run("git", ["-C", project, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
};

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

/** A private clone receives the selected HEAD plus tracked edits, deletions and untracked files. */
export const captureGitBaseline = async (project: string): Promise<Baseline> => {
  const top = (await git(project, "rev-parse", "--show-toplevel")).trim();
  if (top !== (await realpath(project)))
    throw new Error("The selected project must be the Git repository root.");
  const revision = (await git(project, "rev-parse", "HEAD")).trim();
  const root = join(project, ".code-factory", "workspaces");
  await mkdir(root, { recursive: true });
  const workspace = join(root, randomUUID());
  const status = () =>
    git(
      project,
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude).code-factory",
    );
  const before = await status();
  try {
    await run("git", [
      "clone",
      "--quiet",
      "--no-hardlinks",
      "--no-checkout",
      "--local",
      project,
      workspace,
    ]);
    await git(workspace, "checkout", "--quiet", "--detach", revision);
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
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
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
    const after = await status();
    if (before !== after) throw new Error("Project changed while capturing its baseline. Retry.");
    await rejectEscapingLinks(workspace);
    await git(workspace, "add", "--all");
    if ((await git(workspace, "status", "--porcelain")).trim()) {
      await git(
        workspace,
        "-c",
        "user.name=Code Factory",
        "-c",
        "user.email=local@code-factory.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--quiet",
        "-m",
        "Capture run baseline",
      );
    }
    const workspaceRevision = (await git(workspace, "rev-parse", "HEAD")).trim();
    return {
      id: randomUUID(),
      kind: "git",
      revision: workspaceRevision,
      sourceRevision: revision,
      capturedAt: new Date().toISOString(),
      workspace: relative(project, workspace),
      changes: [...new Set([...changed, ...deleted])].sort(),
    };
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
};
