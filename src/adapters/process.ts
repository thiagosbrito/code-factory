import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { planLaunch, type LaunchPlan } from "./launch.js";

export const PROBE_OUTPUT_LIMIT = 600;
const PROBE_TIMEOUT_MS = 30_000;

// oxlint-disable-next-line no-control-regex -- ANSI escape sequences are exactly what is removed.
export const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");

export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * Run a short CLI command with stdin closed, from a neutral directory unless `cwd` says otherwise:
 * a probe must not pick up configuration from whatever project the runtime was started in. A failure names the command and says whether it
 * timed out, exited with a code or was killed by a signal, followed by the CLI's own output, so
 * Settings can show the real cause instead of a bare "Command failed".
 */
export const probeCommand = (
  executable: string,
  args: string[],
  options: {
    label: string;
    timeoutHint: string;
    cwd?: string;
    timeoutMs?: number;
    /** Resolve with stdout on any exit code, for commands that report state through it. */
    allowNonZeroExit?: boolean;
  },
): Promise<string> =>
  new Promise((resolve, reject) => {
    const command = `${options.label} ${args.join(" ")}`;
    const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
    let launch: LaunchPlan;
    try {
      launch = planLaunch(executable, args);
    } catch (error) {
      const code = error instanceof Error ? Reflect.get(error, "code") : undefined;
      const reason = error instanceof Error ? error.message : String(error);
      reject(
        new Error(
          `${command} could not start: ${typeof code === "string" ? `${code} ` : ""}${reason}`,
        ),
      );
      return;
    }
    const child = spawn(launch.command, launch.args, {
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
      cwd: options.cwd ?? tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          `${command} could not start: ${"code" in error && typeof error.code === "string" ? error.code : error.message}`,
        ),
      );
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const output = stripAnsi(stderr.trim() || stdout.trim()).slice(-PROBE_OUTPUT_LIMIT);
      if (timedOut)
        reject(
          new Error(
            `${command} did not finish within ${timeoutMs / 1000} s. ${options.timeoutHint}; run \`${command}\` in a terminal to check.${output ? `\n${output}` : ""}`,
          ),
        );
      else if (code !== 0 && !(options.allowNonZeroExit && code !== null))
        reject(
          new Error(
            `${command} ${code === null ? `was stopped by ${signal ?? "a signal"}` : `exited with code ${code}`}: ${output || "no output"}`,
          ),
        );
      else resolve(stdout);
    });
  });

/** Stop a child launched in its own process group, including the processes it started. */
export const terminateChild = (child: ReturnType<typeof spawn>): void => {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") killProcessTree(child);
    else process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ESRCH") return;
      // macOS can deny a group signal while a CLI is exiting. The owned child's
      // handle remains safe to terminate and must not mask a stream parser error.
      if (error.code === "EPERM" && process.platform !== "win32") {
        child.kill("SIGTERM");
        return;
      }
    }
    throw error;
  }
};

/**
 * Force-stop a child and everything it started. A `.cmd` launcher runs through cmd.exe, so on
 * Windows killing the handle would stop only cmd.exe and orphan the agent; `taskkill /T /F` ends
 * the whole tree and is started without a shell. Elsewhere the child is signalled directly.
 */
export const killProcessTree = (
  child: Pick<ChildProcess, "pid" | "kill">,
  options: {
    platform?: NodeJS.Platform;
    spawnProcess?: (
      command: string,
      args: readonly string[],
      options: { stdio: "ignore"; windowsHide: true },
    ) => {
      once(event: "error" | "close", listener: (code?: number | null) => void): unknown;
    };
  } = {},
): void => {
  if ((options.platform ?? process.platform) !== "win32" || !child.pid) {
    child.kill("SIGKILL");
    return;
  }
  const killer = (options.spawnProcess ?? spawn)(
    "taskkill",
    ["/pid", String(child.pid), "/T", "/F"],
    {
      stdio: "ignore",
      windowsHide: true,
    },
  );
  // taskkill failing (not found, access denied, process already gone) must still stop the handle.
  killer.once("error", () => child.kill("SIGKILL"));
  killer.once("close", (code) => {
    if (code !== 0) child.kill("SIGKILL");
  });
};
