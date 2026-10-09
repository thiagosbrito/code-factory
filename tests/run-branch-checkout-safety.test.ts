import { chmod, lstat, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { READ_ONLY_LEFTOVERS } from "../src/domain/run-branch.js";
import { assertProjectRunCanWrite, returnToPreviousBranch } from "../src/runtime/run-branch.js";
import { cancelRun, executeRun } from "../src/runtime/scheduler.js";
import { mutateRun } from "../src/runtime/storage.js";
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
  savedEnv,
  tidy,
  writer,
} from "./support/run-branch.js";

afterEach(async () => {
  process.env = { ...savedEnv };
  await Promise.all(parents.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("in-project run branch", () => {
  it("fails a reviewer or check that changes project files, reports what changed and reverts nothing", async () => {
    const { root } = await repository();
    const touchingReviewer = acting(async (input) => {
      if (input.stepId === "implement")
        await writeFile(join(input.projectDirectory, "feature.txt"), "feature\n");
      if (input.stepId === "review") {
        await writeFile(join(input.projectDirectory, "file.txt"), "reviewer edit\n");
        await writeFile(join(input.projectDirectory, "notes.txt"), "reviewer notes\n");
      }
    });
    const reviewed = await createProjectRun(root);
    const done = await executeRun(root, reviewed.snapshot.id, () => touchingReviewer);
    expect(done.status).toBe("failed");
    const failure = outcome(done).failures.find((line) => line.startsWith("review:")) ?? "";
    expect(failure).toContain("Reviewer changed project files");
    expect(failure).toContain("modified file.txt");
    expect(failure).toContain("added notes.txt");
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("reviewer edit\n");
    expect(await readFile(join(root, "notes.txt"), "utf8")).toBe("reviewer notes\n");
    expect(git(root, "log", "--format=%s", "-1")).toContain("Implement (implement)");

    const clean = await repository();
    const check = {
      id: "check",
      name: "Check",
      kind: "check",
      stage: "validation",
      role: "checker",
      instruction: `${JSON.stringify(process.execPath)} -e "require('fs').writeFileSync('formatted.txt','x')"`,
    };
    const checked = await createProjectRun(
      clean.root,
      loopWith([implement, check], [{ from: "implement", to: "check" }]),
    );
    const result = await executeRun(clean.root, checked.snapshot.id, () => writer);
    expect(result.status).toBe("failed");
    expect(outcome(result).failures.join("\n")).toContain("Check changed project files");
    expect(outcome(result).failures.join("\n")).toContain("added formatted.txt");
    await expect(lstat(join(clean.root, "formatted.txt"))).resolves.toBeTruthy();
  });

  it("fails the next step with evidence when the checkout leaves the run branch mid-run", async () => {
    const { root } = await repository();
    const run = await createProjectRun(
      root,
      loopWith([implement, tidy], [{ from: "implement", to: "tidy" }]),
    );
    const branch = run.snapshot.baseline.branch ?? "";
    // Like a user switching branches right after the first step's commit.
    const hook = join(root, ".git", "hooks", "post-commit");
    await writeFile(hook, "#!/bin/sh\ngit switch -q main\n");
    await chmod(hook, 0o755);
    const started: string[] = [];
    const recording = acting(async (input) => {
      started.push(input.stepId);
      if (input.stepId === "implement")
        await writeFile(join(input.projectDirectory, "feature.txt"), "feature\n");
    });
    const done = await executeRun(root, run.snapshot.id, () => recording);
    expect(started).toEqual(["implement"]);
    expect(done.status).toBe("failed");
    const moved = done.evidence.find(
      (item) => item.kind === "event" && item.stepId === "tidy" && item.title === "checkout-moved",
    );
    expect(moved?.kind === "event" && moved.detail).toBe(
      `The project is on branch main, not on run branch ${branch}. Switch back with \`git switch ${branch}\` to continue this run.`,
    );
    expect(git(root, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });

  it("refuses to continue over a reviewer's leftover changes until the user resolves them", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root);
    const touching = acting(async (input) => {
      if (input.stepId === "implement")
        await writeFile(join(input.projectDirectory, "feature.txt"), "feature\n");
      if (input.stepId === "review")
        await writeFile(join(input.projectDirectory, "file.txt"), "reviewer edit\n");
    });
    const failed = await executeRun(root, run.snapshot.id, () => touching);
    expect(failed.status).toBe("failed");
    await expect(assertProjectRunCanWrite(root, failed, { fresh: false })).rejects.toThrow(
      READ_ONLY_LEFTOVERS,
    );
    git(root, "checkout", "--", "file.txt");
    await expect(assertProjectRunCanWrite(root, failed, { fresh: false })).resolves.toBeUndefined();
  });

  it("starts from and returns to a detached HEAD", async () => {
    const { root } = await repository();
    const start = git(root, "rev-parse", "HEAD");
    git(root, "switch", "-q", "--detach", "HEAD");
    const run = await createProjectRun(root);
    expect(run.snapshot.baseline.checkout).toEqual({
      previousBranch: null,
      previousRevision: start,
    });
    await executeRun(root, run.snapshot.id, () => writer);
    await returnToPreviousBranch(root, run.snapshot.id);
    expect(gitStatus(root, "symbolic-ref", "--quiet", "HEAD")).toBe(1);
    expect(git(root, "rev-parse", "HEAD")).toBe(start);
  });

  it("cancels a run left running between steps by a restart, freeing the project", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root);
    await mutateRun(root, run.snapshot.id, (current) => ({
      ...current,
      revision: current.revision + 1,
      status: "running",
    }));
    const canceled = await cancelRun(root, run.snapshot.id);
    expect(canceled.status).toBe("canceled");
    await expect(cancelRun(root, crypto.randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(cancelRun(root, run.snapshot.id)).rejects.toMatchObject({ status: 409 });
  });
});
