import { lstat, mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ProjectError } from "./project.js";

const directoryFor = async (project: string, runId: string): Promise<string> => {
  z.uuid().parse(runId);
  let directory = await realpath(project);
  for (const name of [".code-factory", "execution-owners", runId]) {
    directory = join(directory, name);
    await mkdir(directory, { recursive: true });
    if ((await lstat(directory)).isSymbolicLink())
      throw new ProjectError("Execution ownership requires real directories.", 409);
  }
  return directory;
};

const isLive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Permission failures and unknown errors cannot establish that an owner stopped.
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
};

const liveOwner = (entry: string): boolean => {
  const match = /^([1-9][0-9]*)-([0-9a-f-]{36})\.owner$/i.exec(entry);
  const pid = match?.[1] ? Number(match[1]) : NaN;
  return !Number.isSafeInteger(pid) || !z.uuid().safeParse(match?.[2]).success || isLive(pid);
};

/** Read-only presence check; absence does not itself authorize a mutation. */
export const hasRunOwner = async (project: string, runId: string): Promise<boolean> => {
  z.uuid().parse(runId);
  const path = join(await realpath(project), ".code-factory", "execution-owners", runId);
  try {
    return (await readdir(path)).some(liveOwner);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

/**
 * Publish our unique marker before checking contenders. A later contender sees us; simultaneous
 * contenders can both refuse, but cannot both enter. Never expire a live owner by elapsed time.
 * Dead-owner markers are retained: removing another process's marker risks a PID reuse race.
 */
export const withRunOwnership = async <T>(
  project: string,
  runId: string,
  work: () => Promise<T>,
): Promise<T> => {
  const directory = await directoryFor(project, runId);
  const marker = `${process.pid}-${crypto.randomUUID()}.owner`;
  const path = join(directory, marker);
  await writeFile(path, "", { flag: "wx" });
  try {
    for (const entry of await readdir(directory)) {
      if (entry === marker) continue;
      if (liveOwner(entry))
        throw new ProjectError(
          "Run is owned by another runtime. Stop that runtime before recovery.",
          409,
        );
    }
    return await work();
  } finally {
    await rm(path, { force: true });
  }
};
