import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commitStepChanges } from "../src/runtime/run-branch.js";
import {
  createProjectRun,
  git,
  removeParents,
  repository,
  savedEnv,
} from "./support/run-branch.js";

afterEach(async () => {
  process.env = { ...savedEnv };
  await removeParents();
});

const attempt = { id: "attempt-1", number: 1, implementationRound: 1 };

const filesIn = (root: string, revision: string): string[] =>
  git(root, "show", "--name-status", "--format=", revision).split("\n").filter(Boolean).sort();

const writeFactoryData = async (root: string) => {
  await mkdir(join(root, ".code-factory", "evidence"), { recursive: true });
  await writeFile(join(root, ".code-factory", "evidence", "new.json"), "{}\n");
};

// These tests run real Git processes in disposable repositories.
describe("step commits and the .code-factory folder", { timeout: 30_000 }, () => {
  it.each([
    { storage: "ignored by .gitignore", ignored: true },
    { storage: "not ignored", ignored: false },
  ])(
    "commits additions, modifications and deletions but never factory data when storage is $storage",
    async ({ ignored }) => {
      const { root } = await repository();
      if (ignored) {
        await writeFile(join(root, ".gitignore"), "node_modules/\n.code-factory/\n");
        git(root, "add", ".gitignore");
        git(root, "-c", "user.name=Test", "-c", "user.email=t@e.com", "commit", "-qm", "Ignore");
      }
      const run = await createProjectRun(root);
      await writeFactoryData(root);
      await mkdir(join(root, "dir with space"));
      await writeFile(join(root, "dir with space", "new file.txt"), "added\n");
      await writeFile(join(root, "file.txt"), "modified\n");
      await rm(join(root, "remove.txt"));

      const result = await commitStepChanges(root, run, "implement", attempt);

      expect(result.kind).toBe("committed");
      expect(filesIn(root, "HEAD")).toEqual([
        "A\tdir with space/new file.txt",
        "D\tremove.txt",
        "M\tfile.txt",
      ]);
      expect(git(root, "ls-files", ".code-factory")).toBe("");
      expect(await readFile(join(root, ".code-factory", "evidence", "new.json"), "utf8")).toBe(
        "{}\n",
      );
      expect(git(root, "status", "--porcelain", "--", ":(exclude).code-factory")).toBe("");
    },
  );

  it("keeps changes to already tracked factory files out of the commit when storage is ignored", async () => {
    const { root } = await repository();
    await mkdir(join(root, ".code-factory"));
    await writeFile(join(root, ".code-factory", "tracked.json"), "old\n");
    git(root, "add", "-f", ".code-factory/tracked.json");
    await writeFile(join(root, ".gitignore"), "node_modules/\n.code-factory/\n");
    git(root, "add", ".gitignore");
    git(root, "-c", "user.name=Test", "-c", "user.email=t@e.com", "commit", "-qm", "Track");
    const run = await createProjectRun(root);
    await writeFile(join(root, ".code-factory", "tracked.json"), "changed\n");
    await writeFile(join(root, "file.txt"), "modified\n");

    const result = await commitStepChanges(root, run, "implement", attempt);

    expect(result.kind).toBe("committed");
    expect(filesIn(root, "HEAD")).toEqual(["M\tfile.txt"]);
    expect(await readFile(join(root, ".code-factory", "tracked.json"), "utf8")).toBe("changed\n");
  });

  it.each([{ ignored: true }, { ignored: false }])(
    "reports an unchanged step and leaves the branch alone when only factory data changed (ignored: $ignored)",
    async ({ ignored }) => {
      const { root } = await repository();
      if (ignored) {
        await writeFile(join(root, ".gitignore"), "node_modules/\n.code-factory/\n");
        git(root, "add", ".gitignore");
        git(root, "-c", "user.name=Test", "-c", "user.email=t@e.com", "commit", "-qm", "Ignore");
      }
      const run = await createProjectRun(root);
      const before = git(root, "rev-parse", "HEAD");
      await writeFactoryData(root);

      const result = await commitStepChanges(root, run, "implement", attempt);

      expect(result).toEqual({ kind: "unchanged" });
      expect(git(root, "rev-parse", "HEAD")).toBe(before);
      expect(git(root, "diff", "--cached", "--name-only")).toBe("");
    },
  );

  it("leaves Git configuration and unrelated branches untouched", async () => {
    const { root } = await repository();
    await writeFile(join(root, ".gitignore"), "node_modules/\n.code-factory/\n");
    git(root, "add", ".gitignore");
    git(root, "-c", "user.name=Test", "-c", "user.email=t@e.com", "commit", "-qm", "Ignore");
    const mainTip = git(root, "rev-parse", "main");
    const run = await createProjectRun(root);
    const config = await readFile(join(root, ".git", "config"), "utf8");
    await writeFile(join(root, "file.txt"), "modified\n");

    await commitStepChanges(root, run, "implement", attempt);

    expect(git(root, "rev-parse", "main")).toBe(mainTip);
    expect(await readFile(join(root, ".git", "config"), "utf8")).toBe(config);
  });
});
