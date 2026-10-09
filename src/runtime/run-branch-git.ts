import { execFile } from "node:child_process";
import { createKeyedLock } from "./keyed-lock.js";
import { systemCommand } from "./launch-safety.js";

export const OUTPUT_LIMIT = 8192;

export const COMMIT_TIMEOUT_MS = 300_000;

// Every commit Code Factory makes refuses a hostname-derived identity (a per-command override,
// never a config write), so a missing user.name/user.email fails clearly.
export const identityArgs = ["-c", "user.useConfigOnly=true"] as const;

export const LEGACY_PREFIX = ".code-factory/workspaces/";

export const TERMINAL = new Set([
  "succeeded",
  "failed",
  "canceled",
  "rejected",
  "blocked",
  "unavailable",
]);

export type GitResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
};

export const runGit = async (
  cwd: string,
  args: readonly string[],
  timeout = COMMIT_TIMEOUT_MS,
): Promise<GitResult> => {
  let command: string;
  try {
    command = await systemCommand("git");
  } catch {
    return { code: null, stdout: "", stderr: "", timedOut: false, spawnError: "ENOENT" };
  }
  return new Promise((resolveGit) => {
    execFile(
      command,
      ["-C", cwd, ...args],
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => {
        if (!error) return resolveGit({ code: 0, stdout, stderr, timedOut: false });
        const code = "code" in error ? error.code : undefined;
        resolveGit({
          code: typeof code === "number" ? code : null,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          timedOut: error.killed === true && error.signal !== null,
          ...(typeof code === "string" ? { spawnError: code } : {}),
        });
      },
    );
  });
};

export const firstLine = (text: string): string =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "unknown error";

export const git = async (cwd: string, ...args: string[]): Promise<string> => {
  const result = await runGit(cwd, args);
  if (result.code !== 0)
    throw new Error(
      `git ${args.find((arg) => !arg.startsWith("-")) ?? ""} failed: ${result.spawnError ?? firstLine(`${result.stderr}\n${result.stdout}`)}`,
    );
  return result.stdout;
};

export const tail = (result: GitResult, limit = OUTPUT_LIMIT): string => {
  const output = `${result.stdout}${result.stderr}`.slice(-limit);
  return result.timedOut ? `Timed out after ${COMMIT_TIMEOUT_MS / 1000} s\n${output}` : output;
};

export const isCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

/** Serialize checkout, worktree and ref writes per repository against Git's shared locks. */
export const withRepoLock = createKeyedLock();

export const withPromotionLock = createKeyedLock();
