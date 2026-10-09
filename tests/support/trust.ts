import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalServer } from "../../src/runtime/server.js";

export const roots: string[] = [];

export const servers: Awaited<ReturnType<typeof startLocalServer>>[] = [];

export const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

export const temporary = async (prefix: string) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  roots.push(directory);
  return directory;
};
