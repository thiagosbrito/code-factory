import { execFileSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { mockAdapter } from "../src/adapters/mock.js";
import type { AdapterEvent, StepExecutionInput } from "../src/adapters/contract.js";
import { parseLoop } from "../src/domain/loop.js";
import {
  createRunRecord,
  createRunSnapshot,
  type Baseline,
  type RunRecord,
} from "../src/domain/run.js";
import { PROJECT_DIRTY, READ_ONLY_LEFTOVERS, shortRunBranch } from "../src/domain/run-branch.js";
import { inspectDiff, inspectFiles } from "../src/runtime/inspection.js";
import {
  assertProjectRunCanWrite,
  BranchNameError,
  createProjectRunBranch,
  createReviewCopy,
  describeRunWorkspace,
  returnToPreviousBranch,
  rollbackProjectRunBranch,
} from "../src/runtime/run-branch.js";
import { cancelRun, executeRun } from "../src/runtime/scheduler.js";
import { startLocalServer } from "../src/runtime/server.js";
import { createRun, mutateRun, readRun } from "../src/runtime/storage.js";
import { fileDigest, resolveRunWorkspace } from "../src/runtime/workspace.js";

const parents: string[] = [];
const savedEnv = { ...process.env };
afterEach(async () => {
  process.env = { ...savedEnv };
  await Promise.all(parents.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const gitStatus = (cwd: string, ...args: string[]): number => {
  try {
    execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
    return 0;
  } catch (error) {
    return error instanceof Error && "status" in error && typeof error.status === "number"
      ? error.status
      : -1;
  }
};

/** A repo inside a disposable parent, so the sibling `<repo>-code-factory` folder is cleaned up. */
const repository = async (options: { identity?: boolean } = {}) => {
  const parent = await mkdtemp(join(tmpdir(), "factory-branch-"));
  parents.push(parent);
  const root = join(parent, "repo");
  await mkdir(root);
  git(root, "init", "-q", "-b", "main");
  if (options.identity !== false) {
    git(root, "config", "user.name", "Test");
    git(root, "config", "user.email", "test@example.com");
  }
  await writeFile(join(root, "file.txt"), "original\n");
  await writeFile(join(root, "remove.txt"), "remove me\n");
  await writeFile(join(root, ".gitignore"), "node_modules/\n");
  git(root, "add", ".");
  git(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "Initial",
  );
  return { parent, root };
};

const userState = (root: string) => ({
  head: git(root, "rev-parse", "HEAD"),
  branch: git(root, "symbolic-ref", "HEAD"),
  index: git(root, "diff", "--cached"),
  // `.code-factory/` holds Code Factory's own run records, excluded exactly like baseline capture.
  status: git(
    root,
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude).code-factory",
  ),
});
/** Status plus each failed step's completion summary, so a failure explains itself. */
const outcome = (run: RunRecord) => ({
  status: run.status,
  failures: run.steps
    .filter((step) => step.status === "failed")
    .map((step) => {
      const event = [...run.evidence]
        .reverse()
        .find(
          (item) =>
            item.kind === "event" &&
            item.stepId === step.stepId &&
            [
              "completed",
              "Check completed",
              "commit-failed",
              "read-only-violation",
              "execution-interrupted",
            ].includes(item.title),
        );
      return `${step.stepId}: ${event?.kind === "event" ? event.detail : "no summary"}`;
    }),
});

const loopWith = (steps: Record<string, unknown>[], dependencies: { from: string; to: string }[]) =>
  parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 1,
    status: "published",
    steps,
    dependencies,
    groups: [],
    joins: [],
    decisions: [],
    policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 1 },
  });
const implement = {
  id: "implement",
  name: "Implement",
  kind: "agent",
  stage: "implementation",
  role: "dev",
  instruction: "Implement",
};
const tidy = {
  id: "tidy",
  name: "Tidy",
  kind: "agent",
  stage: "implementation",
  role: "dev",
  instruction: "Tidy",
};
const review = {
  id: "review",
  name: "Review",
  kind: "agent",
  stage: "review",
  role: "reviewer",
  instruction: "Review",
};

const storeRun = (
  root: string,
  loop: ReturnType<typeof loopWith>,
  baseline: Baseline,
  runId: string,
  options: { ticketId?: string; setupCommand?: string[] },
) =>
  createRun(
    root,
    createRunRecord(
      createRunSnapshot(
        loop,
        options.ticketId
          ? { description: "", ticketId: options.ticketId }
          : { description: "Task" },
        { provider: "mock", model: "default" },
        baseline,
        runId,
        options.setupCommand,
      ),
    ),
  );

/** A new run: a branch in the project itself, with the checkout switched to it. */
const createProjectRun = async (
  root: string,
  loop = loopWith([implement, review], [{ from: "implement", to: "review" }]),
  options: { ticketId?: string; setupCommand?: string[]; branch?: string } = {},
): Promise<RunRecord> => {
  const runId = crypto.randomUUID();
  const baseline = await createProjectRunBranch(root, {
    branch: options.branch ?? (options.ticketId || shortRunBranch(runId)),
  });
  return storeRun(root, loop, baseline, runId, options);
};

/** A run created by the removed worktree mode, rebuilt with plain Git for legacy coverage. */
const createLegacyWorktreeRun = async (
  root: string,
  loop = loopWith([implement, review], [{ from: "implement", to: "review" }]),
): Promise<RunRecord> => {
  const runId = crypto.randomUUID();
  const branch = shortRunBranch(runId);
  const revision = git(root, "rev-parse", "HEAD");
  await mkdir(join(root, "..", "repo-code-factory"), { recursive: true });
  git(root, "worktree", "add", "-q", "-b", branch, join(root, "..", "repo-code-factory", runId));
  return storeRun(
    root,
    loop,
    {
      id: crypto.randomUUID(),
      kind: "git",
      revision,
      sourceRevision: revision,
      capturedAt: new Date().toISOString(),
      workspace: `../repo-code-factory/${runId}`,
      branch,
      changes: [],
    },
    runId,
    {},
  );
};

const worktreeOf = (root: string, run: RunRecord) =>
  join(root, run.snapshot.baseline.workspace ?? "");

/** Mock adapter that runs `act` in the step's directory before completing like the mock. */
const acting = (act: (input: StepExecutionInput) => Promise<void>) => ({
  ...mockAdapter,
  async *execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent> {
    await act(input);
    yield* mockAdapter.execute(input, signal);
  },
});
const writer = acting(async (input) => {
  if (input.stepId === "implement")
    await writeFile(join(input.projectDirectory, "feature.txt"), `${input.stepId}\n`);
});

describe("in-project run branch", () => {
  it("creates the run branch in the project, switches the checkout to it and runs every step there", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root);
    const { baseline } = run.snapshot;
    const branch = shortRunBranch(run.snapshot.id);
    expect(baseline).toMatchObject({
      workspace: ".",
      branch,
      checkout: { previousBranch: "main", previousRevision: baseline.sourceRevision },
    });
    expect(baseline.revision).toBe(baseline.sourceRevision);
    expect(git(root, "symbolic-ref", "--short", "HEAD")).toBe(branch);
    expect(git(root, "worktree", "list").split("\n")).toHaveLength(1);
    const directories: string[] = [];
    const readOnly: Record<string, boolean | undefined> = {};
    const recording = acting(async (input) => {
      directories.push(input.projectDirectory);
      readOnly[input.stepId] = input.readOnly;
      if (input.stepId === "implement")
        await writeFile(join(input.projectDirectory, "feature.txt"), "feature\n");
    });
    const done = await executeRun(root, run.snapshot.id, () => recording);
    expect(outcome(done)).toEqual({ status: "succeeded", failures: [] });
    expect(directories).toEqual([realpathSync(root), realpathSync(root)]);
    // Reviewers always run read-only; writers do not.
    expect(readOnly).toEqual({ implement: undefined, review: true });
    // The user's own folder holds the change, committed on the run branch with their identity.
    expect(await readFile(join(root, "feature.txt"), "utf8")).toBe("feature\n");
    expect(git(root, "log", "-1", "--format=%an <%ae>")).toBe("Test <test@example.com>");
    expect(git(root, "log", "-1", "--format=%s")).toBe(
      "code-factory: Implement (implement) attempt 1",
    );
    expect(git(root, "show", "--name-only", "--format=", "HEAD")).toBe("feature.txt");
    expect(git(root, "status", "--porcelain", "--", ".", ":(exclude).code-factory")).toBe("");
    // Code Factory's run records live in the project but never reach a commit.
    expect(git(root, "log", "--all", "--name-only", "--format=")).not.toContain(".code-factory");
  });

  it.each([
    [
      "staged",
      async (root: string) => {
        await writeFile(join(root, "staged.txt"), "staged\n");
        git(root, "add", "staged.txt");
      },
    ],
    ["unstaged", (root: string) => writeFile(join(root, "file.txt"), "edited\n")],
    ["untracked", (root: string) => writeFile(join(root, "untracked.txt"), "new\n")],
    ["deleted", (root: string) => rm(join(root, "remove.txt"))],
  ])("refuses to start with %s changes and leaves the project untouched", async (_kind, change) => {
    const { root } = await repository();
    await change(root);
    const before = userState(root);
    await expect(createProjectRunBranch(root, { branch: "work" })).rejects.toThrow(PROJECT_DIRTY);
    expect(userState(root)).toEqual(before);
    expect(git(root, "branch", "--list", "work")).toBe("");
  });

  it("does not count ignored files or Code Factory's own data as changes", async () => {
    const { root } = await repository();
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "dep.js"), "ignored\n");
    await mkdir(join(root, ".code-factory"), { recursive: true });
    await writeFile(join(root, ".code-factory", "project.json"), "{}\n");
    const baseline = await createProjectRunBranch(root, { branch: "work" });
    expect(baseline.branch).toBe("work");
    expect(git(root, "symbolic-ref", "--short", "HEAD")).toBe("work");
    expect(await readFile(join(root, ".code-factory", "project.json"), "utf8")).toBe("{}\n");
  });

  it("never reuses or overwrites an existing branch and suggests a free name", async () => {
    const { root } = await repository();
    git(root, "branch", "BMAP-1190");
    const existing = git(root, "rev-parse", "BMAP-1190");
    const error = await createProjectRunBranch(root, { branch: "BMAP-1190" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(BranchNameError);
    expect(error).toMatchObject({ status: 409, suggestedName: "BMAP-1190-2" });
    expect(git(root, "rev-parse", "BMAP-1190")).toBe(existing);
    expect(git(root, "symbolic-ref", "--short", "HEAD")).toBe("main");
    await expect(createProjectRunBranch(root, { branch: "bad..name" })).rejects.toThrow(
      "bad..name is not a valid branch name.",
    );
  });

  it("refuses to start while a merge is in progress", async () => {
    const { root } = await repository();
    await writeFile(join(root, ".git", "MERGE_HEAD"), `${git(root, "rev-parse", "HEAD")}\n`);
    await expect(createProjectRunBranch(root, { branch: "work" })).rejects.toThrow(
      "A merge, rebase, cherry-pick, revert or bisect is in progress",
    );
    expect(git(root, "branch", "--list", "work")).toBe("");
  });

  it("refuses to start without a Git identity and leaves nothing behind", async () => {
    const { parent, root } = await repository({ identity: false });
    process.env.HOME = parent;
    process.env.XDG_CONFIG_HOME = parent;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    await expect(createProjectRunBranch(root, { branch: "work" })).rejects.toThrow(
      "Configure Git user.name and user.email for this repository",
    );
    expect(git(root, "branch", "--list", "work")).toBe("");
    expect(git(root, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });

  it("rolls a just-created branch back to the previous checkout when the run cannot be stored", async () => {
    const { root } = await repository();
    const baseline = await createProjectRunBranch(root, { branch: "work" });
    await rollbackProjectRunBranch(root, baseline);
    expect(git(root, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(git(root, "branch", "--list", "work")).toBe("");
  });

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

  it("gives checks the run's changed files and reviewers the same-candidate validation evidence", async () => {
    const { root } = await repository();
    const validate = {
      id: "validate",
      name: "Validate",
      kind: "agent",
      stage: "validation",
      role: "validator",
      instruction: "Validate",
    };
    const scoped = {
      id: "scoped",
      name: "Scoped lint",
      kind: "check",
      stage: "validation",
      role: "checker",
      instruction:
        'test "$CODE_FACTORY_CHANGED_FILES" = "feature.txt" && test -n "$CODE_FACTORY_BASE_REVISION"',
    };
    const run = await createProjectRun(
      root,
      loopWith(
        [implement, validate, scoped, review],
        [
          { from: "implement", to: "validate" },
          { from: "validate", to: "scoped" },
          { from: "scoped", to: "review" },
        ],
      ),
    );
    const instructions: Record<string, string> = {};
    const recording = acting(async (input) => {
      instructions[input.stepId] = input.instruction;
      if (input.stepId === "implement")
        await writeFile(join(input.projectDirectory, "feature.txt"), "feature\n");
    });
    const done = await executeRun(root, run.snapshot.id, () => recording);
    expect(outcome(done)).toEqual({ status: "succeeded", failures: [] });
    expect(instructions.validate).toContain(
      `This run started at commit ${run.snapshot.baseline.sourceRevision}. Files changed by this run so far (1):\nfeature.txt`,
    );
    // The reviewer depends only on the check, yet sees the validation step two hops back.
    expect(instructions.review).toContain("Input from scoped");
    expect(instructions.review).toContain("Input from validate");
    expect(instructions.review).toContain("Input from implement");
  });

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

describe("promotion and removal through the local API", () => {
  const withServer = async (root: string, work: (url: string) => Promise<void>) => {
    const { server, url } = await startLocalServer({ projectDirectory: root, port: 0 });
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
