import type { AgentConnection } from "../adapters/contract.js";

export type ConnectionViewModel = {
  id: AgentConnection["provider"];
  label: string;
  detail: string;
  verified: boolean;
  models: { id: string; displayName: string }[];
};
const names: Record<AgentConnection["provider"], string> = {
  codex: "Codex",
  cursor: "Cursor",
  kiro: "Kiro",
  "claude-code": "Claude Code",
  custom: "Custom",
  mock: "Mock",
};
export function connectionViewModel(connection: AgentConnection): ConnectionViewModel {
  const verified =
    connection.installation !== "missing" &&
    connection.authentication === "authenticated" &&
    Boolean(connection.protocol);
  return {
    id: connection.provider,
    label: names[connection.provider],
    detail:
      connection.installation === "missing"
        ? "Executable not found"
        : verified
          ? "Verified connection"
          : "Detected; verification required",
    verified,
    models: verified ? (connection.models ?? []) : [],
  };
}
