import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRunRecord, createRunSnapshot } from "../src/domain/run.js";
import { inspectFiles } from "../src/runtime/inspection.js";
import { createReviewCopy } from "../src/runtime/run-branch.js";
import { executeRun } from "../src/runtime/scheduler.js";
import { createRun, readRun } from "../src/runtime/storage.js";
import { fileDigest, resolveRunWorkspace } from "../src/runtime/workspace.js";
import {
  acting,
  createLegacyWorktreeRun,
  createProjectRun,
  git,
  implement,
  loopWith,
  outcome,
  parents,
  repository,
  savedEnv,
  worktreeOf,
  writer,
} from "./support/run-branch.js";

afterEach(async () => {
  process.env = { ...savedEnv };
  await Promise.all(parents.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("legacy worktree and clone runs", () => {
  it("gives reviewers a private copy without a remote, so their commits never reach the run branch", async () => {
    const { root } = await repository();
    const run = await createLegacyWorktreeRun(root);
    const worktree = worktreeOf(root, run);
    git(worktree, "config", "core.excludesFile", join(root, "excludes"));
    await writeFile(join(root, "excludes"), "ignored-by-excludes.txt\n");
    await writeFile(join(worktree, "ignored-by-excludes.txt"), "local\n");
    await mkdir(join(worktree, "sub"));
    git(join(worktree, "sub"), "init", "-q");
    await writeFile(join(worktree, "sub", "nested.txt"), "nested\n");
    git(join(worktree, "sub"), "add", ".");
    git(
      join(worktree, "sub"),
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-qm",
      "nested",
    );
    const remotes: string[] = [];
    const reviewer = acting(async (input) => {
      if (input.stepId === "implement")
        await writeFile(join(input.projectDirectory, "feature.txt"), "x\n");
      if (input.stepId !== "review") return;
      remotes.push(git(input.projectDirectory, "remote"));
      git(
        input.projectDirectory,
        "-c",
        "user.name=R",
        "-c",
        "user.email=r@example.com",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "reviewer",
      );
    });
    const done = await executeRun(root, run.snapshot.id, () => reviewer);
    expect(outcome(done)).toEqual({ status: "succeeded", failures: [] });
    expect(remotes).toEqual([""]);
    const source = run.snapshot.baseline.sourceRevision ?? "";
    expect(git(worktree, "rev-list", "--count", `${source}..HEAD`)).toBe("1");
    expect(git(worktree, "log", "--format=%s")).not.toContain("reviewer");
    expect(await fileDigest(worktree, "git")).toBe(
      done.steps.find((step) => step.stepId === "review")?.candidateId,
    );
    const destinationParent = await mkdtemp(join(tmpdir(), "factory-copy-"));
    parents.push(destinationParent);
    await expect(
      createReviewCopy(worktree, join(destinationParent, "copy"), "wrong"),
    ).rejects.toThrow("Frozen review copy does not match the candidate.");
  });

  it("fails a reviewer whose frozen copy cannot be prepared without interrupting the run", async () => {
    if (process.platform === "win32") return;
    const { root } = await repository();
    const run = await createLegacyWorktreeRun(root);
    const fifo = acting(async (input) => {
      if (input.stepId !== "implement") return;
      await mkdir(join(input.projectDirectory, ".code-factory"), { recursive: true });
      execFileSync("mkfifo", [join(input.projectDirectory, ".code-factory", "copy-blocker.fifo")]);
    });
    const done = await executeRun(root, run.snapshot.id, () => fifo);
    expect(done.status).toBe("failed");
    const reviewStep = done.steps.find((step) => step.stepId === "review");
    expect(reviewStep?.status).toBe("failed");
    const completed = done.evidence.find(
      (item) => item.kind === "event" && item.stepId === "review" && item.title === "completed",
    );
    expect(completed).toBeUndefined();
  });

  it("rejects worktree paths outside the sibling root and links that escape it", async () => {
    const { parent, root } = await repository();
    const run = await createLegacyWorktreeRun(root);
    const outside = {
      ...run,
      snapshot: {
        ...run.snapshot,
        baseline: { ...run.snapshot.baseline, workspace: `../elsewhere/${run.snapshot.id}` },
      },
    };
    await expect(resolveRunWorkspace(root, outside, { legacy: "uuid" })).rejects.toThrow(
      "no available isolated workspace",
    );
    const escapeId = crypto.randomUUID();
    await mkdir(join(parent, "outside"));
    await symlink(join(parent, "outside"), join(parent, "repo-code-factory", escapeId));
    const escaping = {
      ...run,
      snapshot: {
        ...run.snapshot,
        baseline: { ...run.snapshot.baseline, workspace: `../repo-code-factory/${escapeId}` },
      },
    };
    await expect(resolveRunWorkspace(root, escaping, { legacy: "uuid" })).rejects.toThrow(
      "Workspace boundary violated.",
    );
  });

  it("keeps legacy clone runs inspectable", async () => {
    const { root } = await repository();
    const id = crypto.randomUUID();
    const relative = `.code-factory/workspaces/${id}`;
    execFileSync("git", ["clone", "-q", root, join(root, relative)]);
    await writeFile(join(root, relative, "legacy.txt"), "legacy\n");
    const legacy = createRunRecord(
      createRunSnapshot(
        loopWith([implement], []),
        { description: "Legacy" },
        { provider: "mock", model: "default" },
        {
          id: crypto.randomUUID(),
          kind: "git",
          revision: git(root, "rev-parse", "HEAD"),
          sourceRevision: git(root, "rev-parse", "HEAD"),
          workspace: relative,
          capturedAt: new Date().toISOString(),
        },
      ),
    );
    await createRun(root, legacy);
    const loaded = await readRun(root, legacy.snapshot.id);
    if (!loaded) throw new Error("Legacy run did not load");
    const inspected = await inspectFiles(root, loaded);
    expect(inspected.files).toEqual([expect.objectContaining({ path: "legacy.txt" })]);
  });
});

describe("setup command", () => {
  it("runs argv in the project before the first step and records exit code and output", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root, undefined, {
      setupCommand: [
        process.execPath,
        "-e",
        "require('fs').writeFileSync('node_modules.ok','');console.log('setup ok')",
      ],
    });
    const done = await executeRun(root, run.snapshot.id, () => writer);
    expect(done.status).toBe("succeeded");
    const completed = done.evidence.find(
      (item) => item.kind === "event" && item.title === "Setup completed",
    );
    expect(completed?.kind === "event" && completed.state).toBe("succeeded");
    expect(completed?.kind === "event" && completed.detail).toMatch(/^Exit 0\nsetup ok/);
    const setupIndex = done.evidence.findIndex(
      (item) => item.kind === "event" && item.title === "Setup started",
    );
    const firstStep = done.evidence.findIndex(
      (item) => item.kind === "event" && item.stepId === "implement",
    );
    expect(setupIndex).toBeGreaterThanOrEqual(0);
    expect(setupIndex).toBeLessThan(firstStep);
  });

  it("fails the run before any agent step when setup fails or cannot start", async () => {
    const { root } = await repository();
    const failing = await createProjectRun(root, undefined, {
      setupCommand: [process.execPath, "-e", "console.error('install broke');process.exit(3)"],
    });
    const failed = await executeRun(root, failing.snapshot.id, () => writer);
    expect(failed.status).toBe("failed");
    expect(failed.steps.every((step) => step.attempts.length === 0)).toBe(true);
    const detail = failed.evidence.find(
      (item) => item.kind === "event" && item.title === "Setup completed",
    );
    expect(detail?.kind === "event" && detail.detail).toMatch(/^Exit 3\ninstall broke/);

    const missing = await createProjectRun(root, undefined, {
      setupCommand: ["/nonexistent/setup-bin"],
    });
    const notStarted = await executeRun(root, missing.snapshot.id, () => writer);
    const spawn = notStarted.evidence.find(
      (item) => item.kind === "event" && item.title === "Setup completed",
    );
    expect(spawn?.kind === "event" && spawn.detail).toBe(
      "Could not start /nonexistent/setup-bin: ENOENT",
    );
    expect(notStarted.status).toBe("failed");
  });
});
