import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { replaceStorageFile } from "../src/runtime/storage-replace.js";
import { readDraft, saveDraft } from "../src/runtime/storage.js";
import { createLoopDraft } from "../src/domain/loop.js";

const { rename } = vi.hoisted(() => ({
  rename: vi.fn<typeof import("node:fs/promises").rename>(),
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  rename,
}));
const directories: string[] = [];
beforeEach(async () => {
  const filesystem = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  rename.mockReset().mockImplementation(filesystem.rename);
});
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("retries Windows sharing errors and atomically replaces the old file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-replace-"));
  directories.push(directory);
  const source = join(directory, "temporary");
  const target = join(directory, "record.json");
  await writeFile(source, "new");
  await writeFile(target, "old");
  for (const code of ["EPERM", "EBUSY", "EACCES"])
    rename.mockRejectedValueOnce(Object.assign(new Error(code), { code }));
  const replacement = replaceStorageFile(source, target, "win32");
  expect(await readFile(target, "utf8")).toBe("old");
  await replacement;
  expect(await readFile(target, "utf8")).toBe("new");
  expect(await readdir(directory)).toEqual(["record.json"]);
  expect(rename).toHaveBeenCalledTimes(4);
});

it("stops after ten attempts and preserves the original error", async () => {
  const failure = Object.assign(new Error("locked"), { code: "EPERM" });
  rename.mockRejectedValue(failure);
  const rejected = replaceStorageFile("temporary", "record", "win32").catch(
    (error: unknown) => error,
  );
  expect(await rejected).toBe(failure);
  expect(rename).toHaveBeenCalledTimes(10);
});

it.each(["linux", "darwin"] as const)(
  "does not retry permission errors on %s",
  async (platform) => {
    const failure = Object.assign(new Error("denied"), { code: "EPERM" });
    rename.mockRejectedValue(failure);
    await expect(replaceStorageFile("temporary", "record", platform)).rejects.toBe(failure);
    expect(rename).toHaveBeenCalledOnce();
  },
);

it("does not retry unrelated Windows filesystem errors", async () => {
  const failure = Object.assign(new Error("missing"), { code: "ENOENT" });
  rename.mockRejectedValue(failure);
  await expect(replaceStorageFile("temporary", "record", "win32")).rejects.toBe(failure);
  expect(rename).toHaveBeenCalledOnce();
});

it.runIf(process.platform === "win32")(
  "saves a draft after a transient lock and removes its temporary file",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "factory-storage-lock-"));
    directories.push(directory);
    const loop = createLoopDraft("portable", "Before");
    await saveDraft(directory, loop);
    rename.mockRejectedValueOnce(Object.assign(new Error("locked"), { code: "EPERM" }));
    await saveDraft(directory, { ...loop, name: "After" });
    expect((await readDraft(directory, loop.id))?.name).toBe("After");
    expect(
      (await readdir(join(directory, ".code-factory", "loops", loop.id))).filter((name) =>
        name.endsWith(".tmp"),
      ),
    ).toEqual([]);
  },
);
