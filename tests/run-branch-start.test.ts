import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_DIRTY, shortRunBranch } from "../src/domain/run-branch.js";
import {
  BranchNameError,
  createProjectRunBranch,
  rollbackProjectRunBranch,
} from "../src/runtime/run-branch.js";
import { executeRun } from "../src/runtime/scheduler.js";
import {
  acting,
  createProjectRun,
  git,
  outcome,
  parents,
  repository,
  savedEnv,
} from "./support/run-branch.js";

afterEach(async () => {
  process.env = { ...savedEnv };
  await Promise.all(parents.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

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
});
