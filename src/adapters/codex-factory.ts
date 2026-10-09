import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { CodexStdioRpc } from "./codex-rpc.js";
import { CodexAdapter } from "./codex-adapter.js";

/** Verify the executable before starting its native protocol process. */
export const createCodexAdapter = async (executable: string): Promise<CodexAdapter> => {
  const { stdout } = await promisify(execFile)(executable, ["--version"], {
    cwd: tmpdir(),
    timeout: 5000,
  });
  const version = /^codex-cli (\d+\.\d+\.\d+)(?:\s|$)/.exec(stdout.trim())?.[1];
  if (!version) throw new Error("Executable is not a supported Codex CLI");
  // The RPC must exist before the adapter; the holder lets its approval hook reach the adapter.
  const holder: { adapter?: CodexAdapter } = {};
  const rpc = new CodexStdioRpc(executable, {
    approveCommandExecution: (request) => holder.adapter?.approveCommandExecution(request) ?? false,
  });
  holder.adapter = new CodexAdapter(rpc, executable, version);
  return holder.adapter;
};
