import { existsSync } from "node:fs";
import { extname } from "node:path";

/**
 * Windows entries that CreateProcess or cmd.exe can launch, in preference order. npm writes an
 * extensionless bash shim next to its `.cmd` (and `.ps1`) entry; the bare name passes `access`
 * but cannot be launched, so a launchable sibling always wins over it.
 */
export const WINDOWS_LAUNCHABLE_EXTENSIONS = [".exe", ".cmd", ".bat"] as const;

export interface LaunchPlan {
  command: string;
  args: string[];
  /** Pass to `spawn` so Node does not re-quote the command line prepared for cmd.exe. */
  windowsVerbatimArguments: boolean;
}

export interface LaunchEnvironment {
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
  comspec?: string;
}

const COMMAND_SCRIPT = /\.(cmd|bat)$/i;
const CMD_LINE_LIMIT = 8191;
// Characters cmd.exe treats specially; each is prefixed with ^ inside the prepared command line.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** The launchable Windows entry for `path`: an existing .exe/.cmd/.bat sibling, else `path`. */
export const resolveWindowsExecutable = (
  path: string,
  exists: (candidate: string) => boolean = existsSync,
): string => {
  // A bare name is looked up through PATH by discovery; never probe the working directory for it.
  if (!/[\\/]/.test(path)) return path;
  const extension = extname(path).toLowerCase();
  if (WINDOWS_LAUNCHABLE_EXTENSIONS.some((launchable) => launchable === extension)) return path;
  return (
    WINDOWS_LAUNCHABLE_EXTENSIONS.map((launchable) => `${path}${launchable}`).find(exists) ?? path
  );
};

const escapeCommandArgument = (value: string, doubleEscape: boolean): string => {
  // Quote for the C runtime (backslashes before quotes), then escape cmd.exe metacharacters.
  const quoted = `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
  const once = quoted.replace(CMD_META, "^$1");
  return doubleEscape ? once.replace(CMD_META, "^$1") : once;
};

/**
 * How to start `executable` with literal `args`. Node cannot spawn `.cmd`/`.bat` directly (and a
 * shell would reinterpret arguments), so on Windows a command script is run through
 * `cmd.exe /d /s /c` with every metacharacter escaped. Other files launch directly. Arguments that
 * cmd.exe would truncate (line breaks, NUL) are refused rather than altered.
 */
export const planLaunch = (
  executable: string,
  args: readonly string[],
  environment: LaunchEnvironment = {},
): LaunchPlan => {
  const platform = environment.platform ?? process.platform;
  if (platform !== "win32")
    return { command: executable, args: [...args], windowsVerbatimArguments: false };
  const resolved = resolveWindowsExecutable(executable, environment.exists);
  if (!COMMAND_SCRIPT.test(resolved))
    return { command: resolved, args: [...args], windowsVerbatimArguments: false };
  for (const value of [resolved, ...args])
    if (/[\r\n\0]/.test(value))
      throw new Error(
        `${resolved} is a Windows command script and cannot receive an argument with a line break; pass the text through a file or standard input instead.`,
      );
  const exists = environment.exists ?? existsSync;
  if (!exists(resolved))
    throw Object.assign(new Error(`${resolved} was not found`), { code: "ENOENT" });
  // npm's .cmd shims (local and global) expand %* inside another cmd.exe parse, so a .cmd needs a
  // second level of escaping or a quote in an argument could end the quoted text there.
  const doubleEscape = /\.cmd$/i.test(resolved);
  const line = [
    resolved.replace(CMD_META, "^$1"),
    ...args.map((value) => escapeCommandArgument(value, doubleEscape)),
  ].join(" ");
  const comspec = environment.comspec ?? process.env.ComSpec ?? "cmd.exe";
  if (comspec.length + line.length + 12 > CMD_LINE_LIMIT)
    throw new Error(
      `The command line for ${resolved} would exceed the ${CMD_LINE_LIMIT} characters cmd.exe accepts; use fewer or shorter arguments, or install an .exe launcher.`,
    );
  return {
    command: comspec,
    args: ["/d", "/s", "/c", `"${line}"`],
    windowsVerbatimArguments: true,
  };
};
