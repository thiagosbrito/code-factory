import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverAgents } from "../src/adapters/discovery.js";
import { planLaunch } from "../src/adapters/launch.js";
import { probeCommand } from "../src/adapters/process.js";
import { CHANGED_FILES_GATE_PATH } from "../src/domain/gates.js";
import { ensureChangedFilesGate } from "../src/runtime/gates.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const directory = async (files: string[]) => {
  const root = await mkdtemp(join(tmpdir(), "factory-launch-"));
  roots.push(root);
  // Mode 0o755 so POSIX access(X_OK) accepts the fixtures, as Windows does for any file.
  for (const name of files) {
    await writeFile(join(root, name), "");
    await chmod(join(root, name), 0o755);
  }
  return root;
};

const onWindows = {
  platform: "win32" as const,
  comspec: "C:\\Windows\\System32\\cmd.exe",
  systemRoot: "C:\\Windows",
  exists: () => true,
};
const present = (...paths: string[]) => ({
  ...onWindows,
  exists: (p: string) => paths.includes(p),
});

describe("Windows executable discovery", () => {
  it("prefers a launchable .cmd entry over the extensionless npm shim next to it", async () => {
    const root = await directory(["claude", "claude.cmd", "claude.ps1"]);
    const [claude] = (await discoverAgents(root, "win32")).filter(
      (a) => a.provider === "claude-code",
    );
    expect(claude?.executable).toBe(join(root, "claude.cmd"));
  });

  it("prefers .exe, then .cmd, then .bat, and keeps the bare name as the last resort", async () => {
    const both = await directory(["codex", "codex.bat", "codex.cmd", "codex.exe"]);
    const bat = await directory(["codex", "codex.bat"]);
    const bare = await directory(["codex"]);
    const pick = async (root: string) =>
      (await discoverAgents(root, "win32")).find((a) => a.provider === "codex")?.executable;
    expect(await pick(both)).toBe(join(both, "codex.exe"));
    expect(await pick(bat)).toBe(join(bat, "codex.bat"));
    expect(await pick(bare)).toBe(join(bare, "codex"));
  });

  it("reports a tool as missing when only a .ps1 entry exists", async () => {
    const root = await directory(["claude.ps1"]);
    const claude = (await discoverAgents(root, "win32")).find((a) => a.provider === "claude-code");
    expect(claude?.installation).toBe("missing");
  });

  it("keeps the exact-name lookup on other platforms", async () => {
    const root = await directory(["claude", "claude.cmd"]);
    const claude = (await discoverAgents(root, "linux")).find((a) => a.provider === "claude-code");
    expect(claude?.executable).toBe(join(root, "claude"));
  });
});

describe("launch plan", () => {
  it("launches the file directly with unchanged arguments on non-Windows platforms", () => {
    expect(planLaunch("/bin/tool", ["a b", "&"], { platform: "linux" })).toEqual({
      command: "/bin/tool",
      args: ["a b", "&"],
      windowsVerbatimArguments: false,
    });
  });

  it("swaps an extensionless Windows path for its launchable sibling", () => {
    const plan = planLaunch(
      "C:\\bin\\tool",
      ["--x"],
      present("C:\\bin\\tool.exe", "C:\\bin\\tool.cmd"),
    );
    expect(plan).toEqual({
      command: "C:\\bin\\tool.exe",
      args: ["--x"],
      windowsVerbatimArguments: false,
    });
  });

  it("runs a .bat through cmd.exe with a quoted path and double escaping, not a bare spawn", () => {
    const plan = planLaunch("C:\\Program Files\\n\\claude.bat", ["-p", "say hi"], onWindows);
    expect(plan.command).toBe(onWindows.comspec);
    expect(plan.windowsVerbatimArguments).toBe(true);
    expect(plan.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(plan.args[3]).toBe('"C:\\Program^ Files\\n\\claude.bat ^^^"-p^^^" ^^^"say^^^ hi^^^""');
  });

  it("escapes cmd metacharacters so arguments stay literal", () => {
    const [, , , line] = planLaunch(
      "C:\\t\\x.bat",
      ["a&calc|b>c", "%PATH%", 'q"r'],
      onWindows,
    ).args;
    // A .bat expands %* in a second parse, just like npm's .cmd shims: escape twice.
    expect(line).toContain("a^^^&calc^^^|b^^^>c");
    expect(line).toContain("^^^%PATH^^^%");
    expect(line).toContain('q\\^^^"r');
  });

  it("escapes twice for npm node_modules/.bin shims", () => {
    const [, , , line] = planLaunch(
      "C:\\p\\node_modules\\.bin\\eslint.cmd",
      ["a&b"],
      onWindows,
    ).args;
    expect(line).toContain("a^^^&b");
  });

  it("refuses arguments cmd.exe would truncate", () => {
    expect(() => planLaunch("C:\\t\\x.cmd", ["a\nb"], onWindows)).toThrow(/line break/);
    expect(planLaunch("C:\\t\\x.exe", ["a\nb"], onWindows).args).toEqual(["a\nb"]);
  });
});

// A real .cmd shim can only be started by a real Windows cmd.exe; fixtures above cover the plan.
describe.runIf(process.platform === "win32")("native Windows command shims", () => {
  it("starts a .cmd shim in a directory with spaces and passes arguments literally", async () => {
    const root = await directory([]);
    const bin = join(root, "with space");
    await mkdir(bin);
    await writeFile(join(bin, "echoer"), "#!/bin/sh\nexit 9\n");
    await writeFile(
      join(bin, "echoer.cmd"),
      '@echo off\r\nnode -e "console.log(JSON.stringify(process.argv.slice(1)))" %*\r\n',
    );
    const output = await probeCommand(join(bin, "echoer"), ["a b", "x&y", "100%"], {
      label: "echoer",
      timeoutHint: "",
    });
    expect(JSON.parse(output)).toEqual(["a b", "x&y", "100%"]);
  });
});

describe.runIf(process.platform === "win32")("native Windows gate tools", () => {
  it("runs a project tool that only has a .cmd entry beside its bash shim", async () => {
    const root = await directory([]);
    const bin = join(root, "node_modules", ".bin");
    await mkdir(bin, { recursive: true });
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a b.ts"), "export const a = 1\n");
    await writeFile(join(bin, "eslint"), "#!/bin/sh\nexit 9\n");
    await writeFile(join(bin, "eslint.cmd"), '@echo off\r\nnode "%~dp0eslint-args.cjs" %*\r\n');
    await writeFile(
      join(bin, "eslint-args.cjs"),
      "require('fs').writeFileSync('args.json', JSON.stringify(process.argv.slice(2)))\n",
    );
    await ensureChangedFilesGate(root);
    const result = spawnSync(process.execPath, [CHANGED_FILES_GATE_PATH, "lint"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CODE_FACTORY_CHANGED_FILES: "src/a b.ts" },
    });
    expect(`${result.stdout}${result.stderr}`).toContain("Lint passed for changed files.");
    expect(JSON.parse(await readFile(join(root, "args.json"), "utf8"))).toEqual([
      "--quiet",
      "--",
      "src/a b.ts",
    ]);
  });
});

describe("probeCommand errors", () => {
  it("names the command and ENOENT when the tool does not exist", async () => {
    await expect(
      probeCommand(join(tmpdir(), "factory-missing-tool-xyz"), ["--version"], {
        label: "missing",
        timeoutHint: "",
      }),
    ).rejects.toThrow(/missing --version could not start: ENOENT/);
  });
});
