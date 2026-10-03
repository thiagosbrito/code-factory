import type { AgentConnection, CapabilitySupport } from "../adapters/contract.js";

const capabilityLabels = { streaming: "Streaming", steering: "Guidance", resume: "Recovery" };

function capabilityStatus(
  support: CapabilitySupport,
  connection: AgentConnection,
  connected: boolean,
): string {
  if (support === "unsupported") return "Unsupported";
  if (connection.authentication === "unauthenticated") return "Authentication required";
  if (!connected) return "Unavailable until connected";
  if (support === "supported") return "Available";
  return "Unknown for this connection";
}

export function AgentCapabilities({
  connection,
  connected,
}: {
  connection: AgentConnection;
  connected: boolean;
}) {
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-3">
      {(["streaming", "steering", "resume"] as const).map((capability) => (
        <div key={capability} className="rounded-lg border p-3 text-sm">
          <strong className="block">{capabilityLabels[capability]}</strong>
          <span className="text-xs text-muted-foreground">
            {capabilityStatus(connection.capabilities[capability], connection, connected)}
          </span>
        </div>
      ))}
    </div>
  );
}
