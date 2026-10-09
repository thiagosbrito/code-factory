import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import { retryBlocker } from "../src/domain/run.js";
import { PROJECT_DIRTY } from "../src/domain/run-branch.js";
import { executeRun } from "../src/runtime/scheduler.js";
import { startLocalServer } from "../src/runtime/server.js";
import { trustProject } from "../src/runtime/trust.js";
import { readRun } from "../src/runtime/storage.js";
import {
  createLegacyWorktreeRun,
  createProjectRun,
  git,
  implement,
  loopWith,
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

describe("promotion and removal through the local API", () => {
  const withServer = async (root: string, work: (url: string) => Promise<void>) => {
    await trustProject(root);
    const { server, url } = await startLocalServer({
      sessionToken: null,
      projectDirectory: root,
      port: 0,
    });
    try {
      await work(url);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  };
  const post = (url: string, body?: unknown) =>
    fetch(url, {
      method: "POST",
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });

  it("refuses promotion before acceptance and creates the ticket branch with the same commits after it", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root, undefined, {
      ticketId: "BMAP-1190",
      branch: "work/bmap",
    });
    await executeRun(root, run.snapshot.id, () => writer);
    const branch = run.snapshot.baseline.branch ?? "";
    git(root, "branch", "taken", "main");
    const taken = git(root, "rev-parse", "taken");
    await withServer(root, async (url) => {
      const base = `${url}/api/runs/${run.snapshot.id}`;
      const workspace = await (await fetch(`${base}/workspace`)).json();
      expect(workspace.workspace).toMatchObject({
        kind: "project",
        branch,
        state: "present",
        defaultBranchName: "BMAP-1190",
        dirty: false,
      });
      const early = await post(`${base}/promote`, { branch: "BMAP-1190" });
      expect(early.status).toBe(409);
      expect((await early.json()).error).toBe(
        "Accept the evidence before creating a ticket branch.",
      );
      expect((await post(`${base}/evidence`)).status).toBe(200);
      for (const bad of ["bad..name", "", "@{-1}", "main", "code-factory/x"])
        expect((await post(`${base}/promote`, { branch: bad })).status).toBe(400);
      const conflict = await post(`${base}/promote`, { branch: "taken" });
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toEqual({
        error: "Branch taken already exists. Choose another name.",
        suggestedName: "taken-2",
      });
      expect(git(root, "rev-parse", "taken")).toBe(taken);
      const created = await post(`${base}/promote`, { branch: "BMAP-1190" });
      expect(created.status).toBe(200);
      expect((await created.json()).run.promotion).toMatchObject({ branch: "BMAP-1190" });
      expect(git(root, "rev-list", "BMAP-1190")).toBe(git(root, "rev-list", branch));
      // Promotion only adds a ref; the checkout stays on the run branch.
      expect(git(root, "symbolic-ref", "HEAD")).toBe(`refs/heads/${branch}`);
      expect((await post(`${base}/promote`, { branch: "other" })).status).toBe(409);
    });
  });

  it("labels a description-only run's commits with the branch the user named", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root, undefined, { branch: "BMAP-9999" });
    await executeRun(root, run.snapshot.id, () => writer);
    expect(git(root, "log", "-1", "--format=%s")).toBe(
      "BMAP-9999: Implement (implement) attempt 1",
    );
  });

  it("refuses to execute without a connected agent and fails a step retryably if it disconnects", async () => {
    const { root } = await repository();
    const loop = parseLoop({
      ...loopWith([implement], []),
      steps: [{ ...implement, binding: { provider: "kiro", model: "agent-default" } }],
    });
    const run = await createProjectRun(root, loop);
    await withServer(root, async (url) => {
      const refused = await post(`${url}/api/runs/${run.snapshot.id}/execute`);
      expect(refused.status).toBe(409);
      expect((await refused.json()).error).toContain(
        "kiro is not connected in this Code Factory session",
      );
    });
    expect((await readRun(root, run.snapshot.id))?.status).toBe("pending");
    // If the agent disconnects after the check, the step fails with its reason and stays retryable.
    const done = await executeRun(root, run.snapshot.id, () => null);
    expect(done.status).toBe("failed");
    const reason = done.evidence.find(
      (item) => item.kind === "event" && item.title === "agent-not-connected",
    );
    expect(reason?.kind === "event" && reason.detail).toContain("Verify it in Settings");
    expect(retryBlocker(done, "implement")).toBeNull();
  });

  it("needs no promotion when the run branch already carries the ticket name", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root, undefined, { ticketId: "BMAP-7" });
    await executeRun(root, run.snapshot.id, () => writer);
    await withServer(root, async (url) => {
      const base = `${url}/api/runs/${run.snapshot.id}`;
      expect((await post(`${base}/evidence`)).status).toBe(200);
      const refused = await post(`${base}/promote`, { branch: "BMAP-7-copy" });
      expect(refused.status).toBe(409);
      expect((await refused.json()).error).toBe("This run already works on branch BMAP-7.");
    });
  });

  it("switches back to the previous branch only after the run and with a clean tree", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root);
    const branch = run.snapshot.baseline.branch ?? "";
    await withServer(root, async (url) => {
      const base = `${url}/api/runs/${run.snapshot.id}`;
      const pending = (await (await fetch(`${base}/workspace`)).json()).workspace;
      expect(pending.checkout).toMatchObject({
        current: branch,
        onRunBranch: true,
        previousBranch: "main",
        returnBlocker: "Finish or cancel the run before switching back to main.",
      });
      expect((await post(`${base}/checkout/return`)).status).toBe(409);
      expect(git(root, "symbolic-ref", "--short", "HEAD")).toBe(branch);

      await executeRun(root, run.snapshot.id, () => writer);
      await writeFile(join(root, "scratch.txt"), "mine\n");
      const dirty = await post(`${base}/checkout/return`);
      expect(dirty.status).toBe(409);
      expect((await dirty.json()).error).toContain("The project has uncommitted changes.");
      expect(await readFile(join(root, "scratch.txt"), "utf8")).toBe("mine\n");
      await rm(join(root, "scratch.txt"));

      const returned = await post(`${base}/checkout/return`);
      expect(returned.status).toBe(200);
      expect(git(root, "symbolic-ref", "--short", "HEAD")).toBe("main");
      await expect(lstat(join(root, "feature.txt"))).rejects.toThrow("ENOENT");
      // The run branch and its commits stay for review or cherry-pick.
      expect(git(root, "log", "-1", "--format=%s", branch)).toContain("Implement (implement)");
      const after = (await (await fetch(`${base}/workspace`)).json()).workspace;
      expect(after).toMatchObject({ state: "present", commits: [expect.anything()] });
      expect(after.checkout).toMatchObject({ current: "main", onRunBranch: false });
      expect((await post(`${base}/checkout/return`)).status).toBe(409);
    });
  });

  it("refuses to execute an in-project run whose checkout moved, without changing the run", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root);
    const branch = run.snapshot.baseline.branch ?? "";
    git(root, "switch", "-q", "main");
    await withServer(root, async (url) => {
      const refused = await post(`${url}/api/runs/${run.snapshot.id}/execute`);
      expect(refused.status).toBe(409);
      expect((await refused.json()).error).toBe(
        `The project is on branch main, not on run branch ${branch}. Switch back with \`git switch ${branch}\` to continue this run.`,
      );
      git(root, "switch", "-q", branch);
      await writeFile(join(root, "file.txt"), "edited after creation\n");
      const dirty = await post(`${url}/api/runs/${run.snapshot.id}/execute`);
      expect(dirty.status).toBe(409);
      expect((await dirty.json()).error).toBe(PROJECT_DIRTY);
    });
    expect((await readRun(root, run.snapshot.id))?.status).toBe("pending");
  });

  it("blocks removal on changes Git would refuse, then removes the worktree and keeps every branch", async () => {
    const { root } = await repository();
    const run = await createLegacyWorktreeRun(root);
    await executeRun(root, run.snapshot.id, () => writer);
    const worktree = worktreeOf(root, run);
    const branch = run.snapshot.baseline.branch ?? "";
    await withServer(root, async (url) => {
      const base = `${url}/api/runs/${run.snapshot.id}`;
      await mkdir(join(worktree, ".code-factory"), { recursive: true });
      await writeFile(join(worktree, ".code-factory", "x"), "runtime state\n");
      const state = (await (await fetch(`${base}/workspace`)).json()).workspace;
      expect(state).toMatchObject({ dirty: false, removalBlocked: true });
      const blocked = await post(`${base}/worktree/remove`);
      expect(blocked.status).toBe(409);
      expect((await blocked.json()).error).toBe(
        "The worktree has uncommitted changes. Commit or discard them in the worktree first.",
      );
      await rm(join(worktree, ".code-factory"), { recursive: true });
      git(root, "config", "status.showUntrackedFiles", "no");
      await writeFile(join(worktree, "hidden.txt"), "keep me\n");
      expect((await post(`${base}/worktree/remove`)).status).toBe(409);
      expect(await readFile(join(worktree, "hidden.txt"), "utf8")).toBe("keep me\n");
      await rm(join(worktree, "hidden.txt"));
      git(root, "worktree", "lock", worktree);
      const locked = await post(`${base}/worktree/remove`);
      expect((await locked.json()).error).toContain("The worktree is locked.");
      git(root, "worktree", "unlock", worktree);
      await mkdir(join(worktree, "node_modules"));
      await writeFile(join(worktree, "node_modules", "a"), "ignored\n");
      const removed = await post(`${base}/worktree/remove`);
      expect(removed.status).toBe(200);
      expect((await removed.json()).run.worktree).toMatchObject({ removedAt: expect.any(String) });
      expect(git(root, "worktree", "list")).not.toContain(worktree);
      expect(git(root, "branch", "--list", branch)).toContain(branch);
      const again = await post(`${base}/worktree/remove`);
      expect((await again.json()).error).toBe(
        `This run's worktree was already removed; branch ${branch} is kept.`,
      );
      const after = await readRun(root, run.snapshot.id);
      expect(
        after?.evidence.filter(
          (item) => item.kind === "event" && item.title === "worktree-removed",
        ),
      ).toHaveLength(1);
    });
  });

  it("reports a missing worktree on recovery instead of crashing or re-creating it", async () => {
    const { root } = await repository();
    const run = await createLegacyWorktreeRun(root);
    await rm(worktreeOf(root, run), { recursive: true, force: true });
    const done = await executeRun(root, run.snapshot.id, () => writer);
    expect(done.status).toBe("unavailable");
    expect(
      done.evidence.some((item) => item.kind === "event" && item.title === "worktree-missing"),
    ).toBe(true);
    await expect(lstat(worktreeOf(root, run))).rejects.toThrow("ENOENT");
  });
});
