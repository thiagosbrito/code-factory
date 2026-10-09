import { chmod, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectDiff, inspectFiles } from "../src/runtime/inspection.js";
import { describeRunWorkspace } from "../src/runtime/run-branch.js";
import { executeRun } from "../src/runtime/scheduler.js";
import { readRun } from "../src/runtime/storage.js";
import { fileDigest } from "../src/runtime/workspace.js";
import {
  acting,
  createProjectRun,
  git,
  gitStatus,
  implement,
  loopWith,
  outcome,
  parents,
  repository,
  review,
  savedEnv,
  tidy,
  worktreeOf,
  writer,
} from "./support/run-branch.js";

afterEach(async () => {
  process.env = { ...savedEnv };
  await Promise.all(parents.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("in-project run branch", () => {
  it("commits each changing writing step with run, step and attempt trailers and skips no-op steps", async () => {
    const { root } = await repository();
    const run = await createProjectRun(
      root,
      loopWith(
        [implement, tidy, review],
        [
          { from: "implement", to: "tidy" },
          { from: "tidy", to: "review" },
        ],
      ),
      { ticketId: "KRAKEN-1" },
    );
    const worktree = worktreeOf(root, run);
    const done = await executeRun(root, run.snapshot.id, () => writer);
    expect(done.status).toBe("succeeded");
    const source = run.snapshot.baseline.sourceRevision ?? "";
    expect(git(worktree, "rev-list", "--count", `${source}..HEAD`)).toBe("1");
    const message = git(worktree, "log", "-1", "--format=%B");
    const attempt = done.steps.find((step) => step.stepId === "implement")?.attempts.at(-1);
    expect(message).toContain("KRAKEN-1: Implement (implement) attempt 1");
    expect(message).toContain(`Code-Factory-Run: ${run.snapshot.id}`);
    expect(message).toContain("Code-Factory-Step: implement");
    expect(message).toContain(`Code-Factory-Attempt: ${attempt?.id}`);
    const created = done.evidence.filter(
      (item) => item.kind === "event" && item.title === "commit-created",
    );
    expect(created.map((item) => item.stepId)).toEqual(["implement"]);
  });

  it("never rewrites the worktree index from read-only workspace and inspection probes", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root);
    const worktree = worktreeOf(root, run);
    const index = resolve(worktree, git(worktree, "rev-parse", "--git-path", "index"));
    // Same content, new mtime: a plain `git status` would refresh and rewrite the index here.
    await writeFile(join(worktree, "file.txt"), "original\n");
    const future = new Date(Date.now() + 5_000);
    await utimes(join(worktree, "file.txt"), future, future);
    await writeFile(join(worktree, "remove.txt"), "edited\n");
    const before = await readFile(index);
    await describeRunWorkspace(root, run);
    await inspectFiles(root, run);
    expect(await inspectDiff(root, run, "remove.txt")).toMatchObject({ path: "remove.txt" });
    await fileDigest(worktree, "git");
    expect((await readFile(index)).equals(before)).toBe(true);
    // Control: Git really would have taken index.lock and rewritten it without the option.
    git(worktree, "status", "--porcelain");
    expect((await readFile(index)).equals(before)).toBe(false);
  });

  it("treats an executable-bit change as a new candidate", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root);
    const worktree = worktreeOf(root, run);
    const before = await fileDigest(worktree, "git");
    await chmod(join(worktree, "file.txt"), 0o755);
    expect(await fileDigest(worktree, "git")).not.toBe(before);
  });

  it("commits a step while the UI polls the workspace and inspection endpoints", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root);
    const many = acting(async (input) => {
      if (input.stepId !== "implement") return;
      for (let index = 0; index < 100; index += 1)
        await writeFile(join(input.projectDirectory, `generated-${index}.txt`), `${index}\n`);
    });
    let polling = true;
    const poll = (async () => {
      let polls = 0;
      while (polling) {
        const latest = (await readRun(root, run.snapshot.id)) ?? run;
        await describeRunWorkspace(root, latest);
        await inspectFiles(root, latest);
        polls += 1;
        // Back-to-back probes still overlap the commit; the pause keeps parallel test files fed.
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      }
      return polls;
    })();
    const done = await executeRun(root, run.snapshot.id, () => many).finally(() => {
      polling = false;
    });
    expect(await poll).toBeGreaterThan(0);
    expect(outcome(done)).toEqual({ status: "succeeded", failures: [] });
    const worktree = worktreeOf(root, run);
    expect(git(worktree, "log", "-1", "--format=%s")).toContain("Implement (implement) attempt 1");
    expect(git(worktree, "ls-files", "generated-99.txt")).toBe("generated-99.txt");
  }, 30_000);

  it("accepts the ticket key in a commit-msg hook and fails the step when pre-commit rejects", async () => {
    const { root } = await repository();
    const hooks = join(root, ".git", "hooks");
    await writeFile(join(hooks, "commit-msg"), "#!/bin/sh\ngrep -qE '^[A-Z]+-[0-9]+: ' \"$1\"\n");
    await chmod(join(hooks, "commit-msg"), 0o755);
    const accepted = await createProjectRun(root, undefined, { ticketId: "KRAKEN-1" });
    expect((await executeRun(root, accepted.snapshot.id, () => writer)).status).toBe("succeeded");

    // A new run starts from the user's branch again, as after "Back to main".
    git(root, "switch", "-q", "main");
    await writeFile(
      join(hooks, "pre-commit"),
      "#!/bin/sh\necho 'lint failed: feature.txt'\nexit 1\n",
    );
    await chmod(join(hooks, "pre-commit"), 0o755);
    const rejected = await createProjectRun(root, undefined, { ticketId: "KRAKEN-2" });
    const worktree = worktreeOf(root, rejected);
    const tip = git(worktree, "rev-parse", "HEAD");
    const done = await executeRun(root, rejected.snapshot.id, () => writer);
    expect(done.status).toBe("failed");
    expect(done.steps.find((step) => step.stepId === "implement")?.status).toBe("failed");
    const failure = done.evidence.find(
      (item) => item.kind === "event" && item.title === "commit-failed",
    );
    expect(failure?.kind === "event" && failure.detail).toContain("lint failed: feature.txt");
    expect(git(worktree, "rev-parse", "HEAD")).toBe(tip);
  });

  it("fails the step without committing when the agent leaves the run branch", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root);
    const worktree = worktreeOf(root, run);
    const tip = git(worktree, "rev-parse", "HEAD");
    const switcher = acting(async (input) => {
      if (input.stepId !== "implement") return;
      git(input.projectDirectory, "checkout", "-q", "-b", "other");
      await writeFile(join(input.projectDirectory, "feature.txt"), "x\n");
    });
    const done = await executeRun(root, run.snapshot.id, () => switcher);
    expect(done.status).toBe("failed");
    const failure = done.evidence.find(
      (item) => item.kind === "event" && item.title === "commit-failed",
    );
    expect(failure?.kind === "event" && failure.detail).toContain(
      `The checkout is no longer on branch ${run.snapshot.baseline.branch} (HEAD is refs/heads/other)`,
    );
    expect(git(worktree, "log", "-1", "--format=%B", "refs/heads/other")).not.toContain(
      "Code-Factory-Run",
    );
    expect(git(worktree, "rev-parse", `refs/heads/${run.snapshot.baseline.branch}`)).toBe(tip);
    expect(gitStatus(worktree, "diff", "--cached", "--quiet")).toBe(0);
  });
});
