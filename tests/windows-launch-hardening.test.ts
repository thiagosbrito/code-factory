import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { kiroChatArgs, kiroLaunchBlocker } from "../src/adapters/kiro.js";
import { planLaunch, resolveCmdExecutable } from "../src/adapters/launch.js";
import { killProcessTree, probeCommand, terminateChild } from "../src/adapters/process.js";
import { CHANGED_FILES_GATE_PATH } from "../src/domain/gates.js";
import { GATE_LAUNCH_SOURCE } from "../src/runtime/gate-launch.js";
import { ensureChangedFilesGate } from "../src/runtime/gates.js";
import { input } from "./support/adapters.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const scratch = async () => {
  const root = await mkdtemp(join(tmpdir(), "factory-launch-hardening-"));
  roots.push(root);
  return root;
};

const win = (...present: string[]) => ({
  platform: "win32" as const,
  comspec: "C:\\Windows\\System32\\cmd.exe",
  systemRoot: "C:\\Windows",
  exists: (path: string) => present.includes(path),
});

describe("process tree termination", () => {
  const fakeChild = (pid: number | undefined) => {
    const killed: Array<string | number | undefined> = [];
    return {
      child: {
        pid,
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill: (signal?: string | number) => !!killed.push(signal),
      },
      killed,
    };
  };
  const fakeSpawn = (emitError: boolean) => {
    const calls: Array<{ command: string; args: readonly string[]; options: unknown }> = [];
    const run = (command: string, args: readonly string[], options: unknown) => {
      calls.push({ command, args, options });
      let onError: () => void = () => undefined;
      queueMicrotask(() => (emitError ? onError() : undefined));
      return {
        once: (event: "error" | "close", handler: () => void) => {
          if (event === "error") onError = handler;
        },
      };
    };
    return { calls, run };
  };

  it("kills the whole tree with taskkill /T /F on Windows, without a shell", () => {
    const { child, killed } = fakeChild(4242);
    const spawned = fakeSpawn(false);
    killProcessTree(child, {
      platform: "win32",
      systemRoot: "C:\\Windows",
      spawnProcess: spawned.run,
    });
    expect(spawned.calls).toEqual([
      {
        command: "C:\\Windows\\System32\\taskkill.exe",
        args: ["/pid", "4242", "/T", "/F"],
        options: { stdio: "ignore", windowsHide: true },
      },
    ]);
    expect(killed).toEqual([]);
  });

  it("falls back to killing the direct child when taskkill cannot start", async () => {
    const { child, killed } = fakeChild(4242);
    killProcessTree(child, { platform: "win32", spawnProcess: fakeSpawn(true).run });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(killed).toEqual(["SIGKILL"]);
  });

  it("does not run taskkill for a child that already exited (its pid may be reused)", () => {
    const spawned = fakeSpawn(false);
    for (const exited of [
      { exitCode: 0 as number | null, signalCode: null as NodeJS.Signals | null },
      { exitCode: null as number | null, signalCode: "SIGTERM" as NodeJS.Signals | null },
    ]) {
      const { child, killed } = fakeChild(4242);
      killProcessTree({ ...child, ...exited }, { platform: "win32", spawnProcess: spawned.run });
      expect(killed).toEqual([]);
    }
    expect(spawned.calls).toEqual([]);
  });

  it("does not fall back to killing the handle after the child exited meanwhile", async () => {
    const { child, killed } = fakeChild(4242);
    const state = { exitCode: null as number | null, signalCode: null };
    const watched = {
      ...child,
      get exitCode() {
        return state.exitCode;
      },
      signalCode: state.signalCode,
    };
    killProcessTree(watched, { platform: "win32", spawnProcess: fakeSpawn(true).run });
    state.exitCode = 0;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(killed).toEqual([]);
  });

  it("signals the child directly on other platforms", () => {
    const { child, killed } = fakeChild(4242);
    killProcessTree(child, { platform: "linux", spawnProcess: fakeSpawn(false).run });
    expect(killed).toEqual(["SIGKILL"]);
  });
});

describe("Windows system executables", () => {
  it("uses absolute System32 paths and ignores a ComSpec elsewhere", () => {
    expect(resolveCmdExecutable({ SystemRoot: "D:\\Win" })).toBe("D:\\Win\\System32\\cmd.exe");
    expect(resolveCmdExecutable({})).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(
      resolveCmdExecutable({
        SystemRoot: "C:\\Windows",
        ComSpec: "c:\\windows\\system32\\CMD.EXE",
      }),
    ).toBe("c:\\windows\\system32\\CMD.EXE");
    expect(resolveCmdExecutable({ SystemRoot: "C:\\Windows", ComSpec: "C:\\evil\\cmd.exe" })).toBe(
      "C:\\Windows\\System32\\cmd.exe",
    );
  });

  it("refuses to verify a Kiro launcher that is a command script", () => {
    const win32 = {
      platform: "win32" as const,
      exists: (p: string) => p === "C:\\k\\kiro-cli.cmd",
    };
    expect(kiroLaunchBlocker("C:\\k\\kiro-cli", win32)).toMatch(/\.cmd|\.bat/);
    expect(kiroLaunchBlocker("C:\\k\\kiro-cli.cmd", { ...win32, exists: () => true })).toMatch(
      /multi-line/,
    );
    expect(kiroLaunchBlocker("C:\\k\\kiro-cli.exe", { ...win32, exists: () => true })).toBeNull();
    expect(kiroLaunchBlocker("/usr/bin/kiro-cli", { platform: "linux" })).toBeNull();
  });
});

describe("command script quoting", () => {
  it("double-escapes a .bat as well, because %1 and %* are parsed again", () => {
    const [, , , line] = planLaunch("C:\\t\\x.bat", ['a"&b'], win("C:\\t\\x.bat")).args;
    expect(line).toBe('"C:\\t\\x.bat ^^^"a\\^^^"^^^&b^^^""');
  });

  it("double-escapes arguments for a global npm shim outside node_modules", () => {
    const [, , , line] = planLaunch(
      "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd",
      ['a"&b'],
      win("C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd"),
    ).args;
    expect(line).toBe('"C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd ^^^"a\\^^^"^^^&b^^^""');
  });

  it("ignores a ComSpec that is not cmd.exe", () => {
    const plan = planLaunch("C:\\t\\x.bat", [], {
      ...win("C:\\t\\x.bat"),
      comspec: "C:\\evil\\calc.exe",
    });
    expect(plan.command).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("refuses a command line longer than cmd.exe accepts", () => {
    const long = ["x".repeat(8200)];
    expect(() => planLaunch("C:\\t\\x.cmd", long, win("C:\\t\\x.cmd"))).toThrow(/8191/);
    expect(planLaunch("C:\\t\\x.exe", long, win("C:\\t\\x.exe")).args).toEqual(long);
  });

  it("reports a missing command script as ENOENT instead of letting cmd.exe fail obscurely", () => {
    expect(() => planLaunch("C:\\gone\\x.cmd", [], win())).toThrow(
      expect.objectContaining({
        code: "ENOENT",
        message: expect.stringContaining("C:\\gone\\x.cmd"),
      }),
    );
  });

  it("does not probe extensions relative to the working directory for a bare name", () => {
    const plan = planLaunch("claude", ["-p"], win("claude.cmd"));
    expect(plan).toEqual({ command: "claude", args: ["-p"], windowsVerbatimArguments: false });
  });

  it("cannot pass a multi-line Kiro instruction to a .cmd launcher; it says so", () => {
    const args = kiroChatArgs({ ...input, instruction: "first\nsecond" });
    expect(() => planLaunch("C:\\k\\kiro-cli.cmd", args, win("C:\\k\\kiro-cli.cmd"))).toThrow(
      /line break/,
    );
    // An .exe launcher receives it unchanged.
    expect(planLaunch("C:\\k\\kiro-cli.exe", args, win("C:\\k\\kiro-cli.exe")).args).toEqual(args);
  });
});

describe("gate script launch helper", () => {
  interface GatePlan {
    command: string;
    args: string[];
    verbatim: boolean;
  }
  const isGatePlan = (value: unknown): value is GatePlan =>
    typeof value === "object" &&
    value !== null &&
    "command" in value &&
    typeof value.command === "string" &&
    "args" in value &&
    Array.isArray(value.args) &&
    "verbatim" in value &&
    typeof value.verbatim === "boolean";
  const planner: unknown = new Function(`${GATE_LAUNCH_SOURCE}\nreturn planGateLaunch;`)();
  if (typeof planner !== "function")
    throw new Error("planGateLaunch is not exported by the gate source");
  const gatePlan = (
    path: string,
    args: string[],
    platform: string,
    exists: (candidate: string) => boolean,
  ): GatePlan | { error: { code?: unknown; message: string } } => {
    try {
      const plan: unknown = Reflect.apply(planner, undefined, [
        path,
        args,
        platform,
        exists,
        "C:\\Windows\\System32\\cmd.exe",
      ]);
      if (!isGatePlan(plan)) throw new Error("planGateLaunch returned an unexpected shape");
      return plan;
    } catch (error) {
      if (error instanceof Error)
        return { error: { code: Reflect.get(error, "code"), message: error.message } };
      throw error;
    }
  };
  const adapterPlan = (
    path: string,
    args: string[],
    platform: NodeJS.Platform,
    exists: (p: string) => boolean,
  ) => {
    try {
      const plan = planLaunch(path, args, {
        platform,
        exists,
        comspec: "C:\\Windows\\System32\\cmd.exe",
        systemRoot: "C:\\Windows",
      });
      return { command: plan.command, args: plan.args, verbatim: plan.windowsVerbatimArguments };
    } catch (error) {
      if (error instanceof Error)
        return { error: { code: Reflect.get(error, "code"), message: error.message } };
      throw error;
    }
  };

  const everything = () => true;
  const only =
    (...paths: string[]) =>
    (path: string) =>
      paths.includes(path);
  const argv = ["--quiet", "--", "src\\a b.ts", "x&y.ts", "%A%", 'q"r', "tail\\"];
  it.each([
    [
      "npm shim beside a bash shim",
      "C:\\p\\node_modules\\.bin\\eslint",
      argv,
      only("C:\\p\\node_modules\\.bin\\eslint.cmd"),
    ],
    ["global shim", "C:\\n\\npm\\claude", argv, only("C:\\n\\npm\\claude.cmd")],
    [
      "path with spaces",
      "C:\\Program Files\\t\\vitest",
      argv,
      only("C:\\Program Files\\t\\vitest.cmd"),
    ],
    [".exe over .cmd", "C:\\t\\x", argv, only("C:\\t\\x.exe", "C:\\t\\x.cmd")],
    [".cmd over .bat", "C:\\t\\x", argv, only("C:\\t\\x.cmd", "C:\\t\\x.bat")],
    [".bat only", "C:\\t\\x", argv, only("C:\\t\\x.bat")],
    ["already .cmd", "C:\\t\\x.cmd", argv, everything],
    ["already .exe", "C:\\t\\x.exe", argv, everything],
    ["already .bat", "C:\\t\\x.bat", argv, everything],
    ["uppercase .CMD", "C:\\t\\X.CMD", argv, everything],
    ["bare name", "claude", argv, only("claude.cmd")],
    ["no launchable sibling", "C:\\t\\x", argv, only()],
    ["missing command script", "C:\\t\\x.cmd", argv, only()],
    ["line break", "C:\\t\\x.cmd", ["a\nb"], everything],
    ["line break to .exe", "C:\\t\\x.exe", ["a\nb"], everything],
    ["command line too long", "C:\\t\\x.cmd", ["y".repeat(9000)], everything],
  ])("matches the adapter planner on Windows: %s", (_name, path, args, exists) => {
    const gate = gatePlan(path, args, "win32", exists);
    const adapter = adapterPlan(path, args, "win32", exists);
    // Error text may differ in wording; the error code and the fact of failing must match.
    const comparable = (plan: typeof gate) =>
      "error" in plan
        ? { error: { code: plan.error.code, failed: plan.error.message !== "" } }
        : plan;
    expect(comparable(gate)).toEqual(comparable(adapter));
  });

  it.each<[{ SystemRoot?: string; ComSpec?: string }]>([
    [{}],
    [{ SystemRoot: "D:\\Win\\" }],
    [{ SystemRoot: "C:\\Windows", ComSpec: "c:\\windows\\system32\\CMD.EXE" }],
    [{ SystemRoot: "C:\\Windows", ComSpec: "C:\\evil\\cmd.exe" }],
  ])("resolves cmd.exe like the adapter for %j", (env) => {
    const resolver: unknown = new Function(`${GATE_LAUNCH_SOURCE}\nreturn resolveGateCmd;`)();
    if (typeof resolver !== "function") throw new Error("resolveGateCmd is not exported");
    const normalized = { ...env, SystemRoot: env.SystemRoot?.replace(/\\+$/, "") };
    expect(Reflect.apply(resolver, undefined, [env])).toBe(resolveCmdExecutable(normalized));
  });

  it.each(["linux", "darwin"] as const)("is a plain direct launch on %s", (platform) => {
    expect(gatePlan("/p/node_modules/.bin/tsc", ["a b"], platform, everything)).toEqual({
      command: "/p/node_modules/.bin/tsc",
      args: ["a b"],
      verbatim: false,
    });
    expect(adapterPlan("/p/node_modules/.bin/tsc", ["a b"], platform, everything)).toEqual(
      gatePlan("/p/node_modules/.bin/tsc", ["a b"], platform, everything),
    );
  });
});

describe("gate setup errors", () => {
  it("reports an unlaunchable gate tool as a setup error, not as failed lint", async () => {
    const root = await scratch();
    await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.ts"), "export const a = 1\n");
    // A directory where the tool should be makes spawning fail on every OS.
    await mkdir(join(root, "node_modules", ".bin", "eslint"));
    await ensureChangedFilesGate(root);
    const result = spawnSync(process.execPath, [CHANGED_FILES_GATE_PATH, "lint"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CODE_FACTORY_CHANGED_FILES: "src/a.ts" },
    });
    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toMatch(/could not start/i);
  });
});

// Real cmd.exe behavior; these run only on the Windows CI job.
describe.runIf(process.platform === "win32")("native Windows command scripts", () => {
  it("cancels a .cmd launcher together with the long-running process it started", async () => {
    const root = await scratch();
    await writeFile(
      join(root, "child.cjs"),
      `require("fs").writeFileSync(${JSON.stringify(join(root, "pid"))}, String(process.pid)); setInterval(() => {}, 1000)\n`,
    );
    await writeFile(
      join(root, "agent.cmd"),
      `@echo off\r\n"${process.execPath}" "%~dp0child.cjs" %*\r\n`,
    );
    const launch = planLaunch(join(root, "agent.cmd"), []);
    const child = spawn(launch.command, launch.args, {
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
      stdio: "ignore",
    });
    const pidFile = join(root, "pid");
    let pid = 0;
    for (let waited = 0; !pid && waited < 10_000; waited += 100) {
      pid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(pid).toBeGreaterThan(0);
    terminateChild(child);
    let alive = true;
    for (let waited = 0; alive && waited < 10_000; waited += 100) {
      try {
        process.kill(pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
  });

  it("keeps a quote-and-ampersand argument literal for a .bat launcher", async () => {
    const root = await scratch();
    await writeFile(
      join(root, "args.cjs"),
      'require("fs").writeFileSync(require("path").join(__dirname, "args.json"), JSON.stringify(process.argv.slice(2)))\n',
    );
    await writeFile(join(root, "tool.bat"), '@echo off\r\nnode "%~dp0args.cjs" %*\r\n');
    const hostile = 'a" & echo pwned > pwned.txt & "';
    await probeCommand(join(root, "tool.bat"), [hostile, "plain"], {
      label: "tool",
      timeoutHint: "",
      cwd: root,
    });
    expect(JSON.parse(await readFile(join(root, "args.json"), "utf8"))).toEqual([hostile, "plain"]);
    await expect(readFile(join(root, "pwned.txt"), "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("keeps a quote-and-ampersand argument literal for a global-style shim", async () => {
    const root = await scratch();
    await writeFile(
      join(root, "args.cjs"),
      'require("fs").writeFileSync(require("path").join(__dirname, "args.json"), JSON.stringify(process.argv.slice(2)))\n',
    );
    await writeFile(join(root, "tool.cmd"), '@echo off\r\nnode "%~dp0args.cjs" %*\r\n');
    const hostile = 'a" & echo pwned > pwned.txt & "';
    await probeCommand(join(root, "tool.cmd"), [hostile, "plain"], {
      label: "tool",
      timeoutHint: "",
      cwd: root,
    });
    expect(JSON.parse(await readFile(join(root, "args.json"), "utf8"))).toEqual([hostile, "plain"]);
    await expect(readFile(join(root, "pwned.txt"), "utf8")).rejects.toThrow(/ENOENT/);
  });
});
