import type { AgentConnection } from "../adapters/contract.js";

export type ConnectionViewModel = {
  id: AgentConnection["provider"];
  label: string;
  detail: string;
  verified: boolean;
  connected: boolean;
  models: NonNullable<AgentConnection["models"]>;
};
const names: Record<AgentConnection["provider"], string> = {
  codex: "Codex",
  cursor: "Cursor",
  kiro: "Kiro",
  "claude-code": "Claude Code",
  custom: "Custom",
  mock: "Mock",
};
export function unavailableCandidates(): AgentConnection[] {
  return (["codex", "cursor", "kiro", "claude-code", "custom"] as const).map((provider) => ({
    provider,
    executable: null,
    installation: "missing",
    authentication: "unknown",
    capabilities: { streaming: "unknown", steering: "unknown", resume: "unknown" },
    reason: "Discovery unavailable. Recheck to read local adapter results.",
  }));
}
export function connectionViewModel(connection: AgentConnection): ConnectionViewModel {
  const verified =
    connection.installation !== "missing" &&
    Boolean(connection.version && connection.protocol && connection.identity);
  const connected = verified && connection.authentication === "authenticated";
  return {
    id: connection.provider,
    label: names[connection.provider],
    detail:
      connection.reason ??
      (connection.installation === "missing"
        ? "Executable not found"
        : connected
          ? `${connection.identity} ${connection.version} · Connected`
          : verified && connection.authentication === "unauthenticated"
            ? `${connection.identity} ${connection.version} · Authentication required`
            : connection.provider === "codex"
              ? "Detected; verification required"
              : "Detected; connection adapter unavailable"),
    verified,
    connected,
    models: connected ? (connection.models ?? []) : [],
  };
}

export function bindingError(
  binding: {
    provider: AgentConnection["provider"];
    model: string;
    effort?: string | undefined;
  } | null,
  agents: AgentConnection[],
): string | null {
  if (!binding) return null;
  const connection = agents.find((item) => item.provider === binding.provider);
  if (!connection || !connectionViewModel(connection).connected)
    return `${binding.provider} binding is unavailable until its connection is verified and authenticated.`;
  const model = connection.models?.find((item) => item.id === binding.model);
  if (binding.model !== "agent-default" && !model)
    return `Model ${binding.model} is unavailable in the current catalog.`;
  if (binding.effort && !model?.efforts?.includes(binding.effort))
    return `Effort ${binding.effort} is unavailable for this model.`;
  return null;
}
