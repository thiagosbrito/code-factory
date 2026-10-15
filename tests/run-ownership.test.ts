import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { hasRunOwner, withRunOwnership } from "../src/runtime/run-ownership.js";

const roots: string[] = [];
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "factory-owner-"));
  roots.push(root);
  const id = crypto.randomUUID();
  const directory = join(root, ".code-factory", "execution-owners", id);
  await mkdir(directory, { recursive: true });
  return { root, id, directory };
};
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["malformed.owner", `${process.pid}-${crypto.randomUUID()}.owner`])(
  "refuses a malformed or same-process foreign marker: %s",
  async (marker) => {
    const { root, id, directory } = await fixture();
    await writeFile(join(directory, marker), "");
    const work = vi.fn<() => Promise<void>>(async () => undefined);
    await expect(withRunOwnership(root, id, work)).rejects.toThrow("another runtime");
    expect(work).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([marker]);
    expect(await hasRunOwner(root, id)).toBe(true);
  },
);

it("fails closed when probing a foreign owner gives a permission error", async () => {
  const { root, id, directory } = await fixture();
  await writeFile(join(directory, `1234-${crypto.randomUUID()}.owner`), "");
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("denied"), { code: "EPERM" });
  });
  await expect(withRunOwnership(root, id, async () => undefined)).rejects.toThrow(
    "another runtime",
  );
  expect(await readdir(directory)).toHaveLength(1);
});

it("can recover after a real owner exits while retaining its marker", async () => {
  const { root, id, directory } = await fixture();
  const owner = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = owner.pid;
  if (!pid) throw new Error("Owner did not start.");
  await new Promise<void>((resolve, reject) => {
    owner.once("exit", () => resolve());
    owner.once("error", reject);
  });
  const marker = `${pid}-${crypto.randomUUID()}.owner`;
  await writeFile(join(directory, marker), "");
  expect(await hasRunOwner(root, id)).toBe(false);
  await expect(withRunOwnership(root, id, async () => "recovered")).resolves.toBe("recovered");
  expect(await readdir(directory)).toEqual([marker]);
});

it("never lets two separate runtime processes enter at the same time", async () => {
  const { root, id } = await fixture();
  const module = new URL("../src/runtime/run-ownership.ts", import.meta.url).href;
  const source = `
    import { withRunOwnership } from ${JSON.stringify(module)};
    process.stdin.resume();
    process.stdin.once('data', async () => {
      try {
        await withRunOwnership(process.argv[1], process.argv[2], async () => {
          process.stdout.write('owned\\n');
          await new Promise(resolve => process.stdin.once('data', resolve));
        });
      } catch { process.stdout.write('refused\\n'); }
      process.stdin.pause();
    });
    process.stdout.write('ready\\n');
  `;
  const children = [0, 1].map(() =>
    spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source, root, id], {
      stdio: "pipe",
    }),
  );
  const exits = children.map(
    (child) => new Promise<void>((resolve) => child.once("exit", () => resolve())),
  );
  const lines = children.map((child) => {
    let buffer = "";
    const pending: ((line: string) => void)[] = [];
    const queued: string[] = [];
    child.stdout.on("data", (data: Buffer) => {
      buffer += data.toString();
      for (;;) {
        const end = buffer.indexOf("\n");
        if (end < 0) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        const next = pending.shift();
        if (next) next(line);
        else queued.push(line);
      }
    });
    return () =>
      new Promise<string>((resolve) => {
        const line = queued.shift();
        if (line !== undefined) resolve(line);
        else pending.push(resolve);
      });
  });
  try {
    expect(await Promise.all(lines.map((next) => next()))).toEqual(["ready", "ready"]);
    children.forEach((child) => child.stdin.write("start\n"));
    const results = await Promise.all(lines.map((next) => next()));
    expect(results.every((result) => ["owned", "refused"].includes(result))).toBe(true);
    expect(results.filter((result) => result === "owned").length).toBeLessThanOrEqual(1);
    children.forEach((child, index) => {
      if (results[index] === "owned") child.stdin.write("finish\n");
    });
    await Promise.all(exits);
  } finally {
    children.forEach((child) => {
      if (child.exitCode === null) child.kill();
    });
    await Promise.all(exits);
  }
}, 15_000);
