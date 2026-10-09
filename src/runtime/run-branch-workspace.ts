import { realpath } from "node:fs/promises";
import { join } from "node:path";
import type { RunRecord } from "../domain/run.js";
import { defaultTicketBranch, isProjectRun, type RunWorkspace } from "../domain/run-branch.js";
import { ProjectError } from "./project.js";
import { resolveRunWorkspace, worktreeRelativePath, worktreeRootFor } from "./workspace.js";
import { LEGACY_PREFIX, runGit, git } from "./run-branch-git.js";
import { isPromotionDirty, isRemovalBlockedByChanges } from "./run-branch-status.js";
import { describeCheckout } from "./run-branch-project.js";

export const projectRunPath = async (
  project: string,
  record: RunRecord,
): Promise<string | null> => {
  const workspace = record.snapshot.baseline.workspace ?? "";
  const { root, base } = await worktreeRootFor(project);
  const runId = workspace.split("/").at(-1) ?? "";
  return workspace === worktreeRelativePath(base, runId) ? join(root, runId) : null;
};

export const parseLog = (log: string) =>
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
