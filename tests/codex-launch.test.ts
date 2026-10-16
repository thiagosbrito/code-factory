import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodexAdapter } from "../src/adapters/codex.js";
import * as processModule from "../src/adapters/process.js";
import { writeNodeExecutable } from "./support/node-executable.js";

vi.mock("../src/adapters/process.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/adapters/process.js")>();
  return { ...actual, probeCommand: vi.fn<typeof actual.probeCommand>(actual.probeCommand) };
});

const directories: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
const scratch = async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-codex-launch-"));
  directories.push(directory);
  return directory;
};

describe("Codex version probe", () => {
  it("goes through the shared launch-aware probe instead of a bare execFile", async () => {
    const directory = await scratch();
    const executable = join(directory, "codex");
    await writeNodeExecutable(
      executable,
      "#!/usr/bin/env node\nif (process.argv[2] === '--version') console.log('codex-cli 0.160.0'); else setInterval(() => {}, 1000);\n",
    );
    const adapter = await createCodexAdapter(executable);
    adapter.close();
    expect(processModule.probeCommand).toHaveBeenCalledWith(
      executable,
      ["--version"],
      expect.objectContaining({ label: "codex" }),
    );
  });
});

// Real cmd.exe behavior: an npm-installed codex.cmd must verify and start end to end.
describe.runIf(process.platform === "win32")("native Windows codex.cmd", () => {
  it("verifies and starts the app-server through a codex.cmd shim", async () => {
    const directory = await scratch();
    await writeFile(join(directory, "idle.cjs"), "setInterval(() => {}, 1000)\n");
    await writeFile(
      join(directory, "codex.cmd"),
      '@echo off\r\nif "%~1"=="--version" (\r\n  echo codex-cli 0.160.0\r\n) else (\r\n  node "%~dp0idle.cjs"\r\n)\r\n',
    );
    const adapter = await createCodexAdapter(join(directory, "codex.cmd"));
    adapter.close();
    expect(processModule.probeCommand).toHaveBeenCalled();
  });
});
