import { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexStdioRpc } from "../src/adapters/codex-rpc.js";
import { killProcessTree } from "../src/adapters/process.js";
import { writeNodeExecutable } from "./support/node-executable.js";

afterEach(() => vi.restoreAllMocks());

describe("Codex app-server shutdown", () => {
  it("lets the caller pick the non-Windows signal; timeouts keep SIGKILL", () => {
    const kill = vi.fn<(signal?: string | number) => boolean>(() => true);
    const child = { pid: 1, exitCode: null, signalCode: null, kill };
    killProcessTree(child, { platform: "linux", signal: "SIGTERM" });
    killProcessTree(child, { platform: "darwin" });
    expect(kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
  });

  // POSIX only: Windows ends the whole tree with taskkill instead of signalling.
  it.runIf(process.platform !== "win32")(
    "close() asks the app-server to stop with SIGTERM",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "factory-codex-close-"));
      try {
        const executable = join(directory, "codex");
        await writeNodeExecutable(
          executable,
          "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n",
        );
        const kill = vi.spyOn(ChildProcess.prototype, "kill");
        const rpc = new CodexStdioRpc(executable);
        rpc.close();
        expect(kill).toHaveBeenCalledWith("SIGTERM");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
