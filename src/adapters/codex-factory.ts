import { CodexStdioRpc } from "./codex-rpc.js";
import { CodexAdapter } from "./codex-adapter.js";
import { probeCommand } from "./process.js";

/** Verify the executable before starting its native protocol process. */
export const createCodexAdapter = async (executable: string): Promise<CodexAdapter> => {
  // probeCommand starts .cmd/.bat shims correctly on Windows; a bare execFile cannot.
  const stdout = await probeCommand(executable, ["--version"], {
    label: "codex",
    timeoutHint: "Codex did not answer --version",
    timeoutMs: 5000,
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
