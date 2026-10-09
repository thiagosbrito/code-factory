import { spawn, type ChildProcess } from "node:child_process";
import { type StepResult } from "../domain/scheduler.js";

export const processGroupExists = (pid: number): boolean => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
};

export const waitForProcessGroupExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(pid) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 25));
  return !processGroupExists(pid);
};

export const terminateCheckTree = async (child: ChildProcess): Promise<boolean> => {
  if (!child.pid) return false;
  if (process.platform === "win32")
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => resolve(child.exitCode !== null));
      killer.once("close", (code) => resolve(code === 0 || child.exitCode !== null));
    });
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
  if (await waitForProcessGroupExit(child.pid, 2_000)) return true;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) return false;
  }
  return waitForProcessGroupExit(child.pid, 2_000);
};

export type CommandInvocation = { shell: string } | { argv: readonly string[] };
export type CommandResult = StepResult & {
  spawnFailed?: boolean;
  spawnErrorCode?: string;
  timedOut?: boolean;
  output?: string;
};

export const checkCommand = async (
  invocation: CommandInvocation,
  cwd: string,
  signal: AbortSignal,
  onOutput: (text: string) => Promise<void>,
  timeoutMs = 300_000,
  env?: NodeJS.ProcessEnv,
): Promise<CommandResult> =>
  new Promise((resolveCheck) => {
    if (signal.aborted) return resolveCheck({ status: "canceled" });
    const options = {
      cwd,
      stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      ...(env ? { env } : {}),
    };
    const child =
      "shell" in invocation
        ? spawn(invocation.shell, { ...options, shell: true })
        : spawn(invocation.argv[0] ?? "", invocation.argv.slice(1), { ...options, shell: false });
    let output = "";
    let buffered = "";
    let retained = 0;
    let truncated = false;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let pending = Promise.resolve();
    const queue = (text: string) => {
      pending = pending.then(() => onOutput(text));
    };
    const flush = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = undefined;
      if (buffered) {
        queue(buffered);
        buffered = "";
      }
    };
    const capture = (chunk: Buffer) => {
      const text = chunk.toString();
      output = (output + text).slice(-8192);
      const remaining = Math.max(0, 8192 - retained);
      const captured = text.slice(0, remaining);
      retained += captured.length;
      buffered += captured;
      if (buffered.length >= 1024) flush();
      else if (buffered && !flushTimer) flushTimer = setTimeout(flush, 100);
      if (text.length > remaining && !truncated) {
        flush();
        queue(
          "[Check output truncated after 8192 characters; final result retains the last 8192 characters.]",
        );
        truncated = true;
      }
    };
    child.stdout.on("data", (chunk: Buffer) => {
      capture(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      capture(chunk);
    });
    let stopReason: "abort" | "timeout" | undefined;
    let termination: Promise<boolean> | undefined;
    const stop = (reason: "abort" | "timeout") => {
      stopReason ??= reason;
      termination ??= terminateCheckTree(child);
    };
    const timeout = setTimeout(() => stop("timeout"), timeoutMs);
    const abort = () => stop("abort");
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      flush();
      const failed: CommandResult = {
        status: "failed",
        outcome: "failed",
        summary: error.message,
        exitCode: null,
        spawnFailed: true,
        ...("code" in error && typeof error.code === "string"
          ? { spawnErrorCode: error.code }
          : {}),
      };
      void pending.then(
        () => resolveCheck(failed),
        () => resolveCheck(failed),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      flush();
      void Promise.all([pending, termination ?? Promise.resolve(true)]).then(
        ([, stopped]) =>
          resolveCheck({
            status: !stopped
              ? "unavailable"
              : stopReason === "abort"
                ? "canceled"
                : code === 0 && !stopReason
                  ? "succeeded"
                  : "failed",
            outcome: code === 0 ? "passed" : "failed",
            summary: !stopped
              ? "Check process-tree termination could not be confirmed."
              : stopReason === "timeout"
                ? `${output}\nCheck timed out after ${timeoutMs}ms.`.trim()
                : output,
            exitCode: code,
            timedOut: stopReason === "timeout",
            output,
          }),
        () => resolveCheck({ status: "failed", summary: "Check output could not be persisted." }),
      );
    });
  });
