import type { AgentConnection } from "../adapters/contract.js";
import type { ProviderId } from "../domain/loop.js";
import { connectionViewModel } from "./connection";

function candidateStatus(connection: AgentConnection): string {
  const view = connectionViewModel(connection);
  if (view.connected) return "Connected";
  if (view.verified) return "Identity verified";
  if (connection.installation === "detected") return "Executable detected";
  return "Not detected";
}

export function AgentCandidates({
  agents,
  selected,
  onSelect,
}: {
  agents: AgentConnection[];
  selected: ProviderId | null;
  onSelect: (provider: ProviderId | null) => void;
}) {
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={selected === null}
          className={`rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === null ? "border-teal-600 bg-teal-50" : "border-border"}`}
        >
          <span className="block text-sm font-semibold">No default agent</span>
          <span className="text-xs text-muted-foreground">Configure later</span>
        </button>
        {agents.map((connection) => {
          const view = connectionViewModel(connection);
          return (
            <button
              type="button"
              key={connection.provider}
              onClick={() => onSelect(connection.provider)}
              aria-pressed={selected === connection.provider}
              className={`rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === connection.provider ? "border-teal-600 bg-teal-50" : "border-border"}`}
            >
              <span className="block text-sm font-semibold">{view.label}</span>
              <span className="block text-xs text-muted-foreground">{view.detail}</span>
              <span className="mt-1 block text-xs">{candidateStatus(connection)}</span>
            </button>
          );
        })}
      </div>
      {agents.length === 0 && (
        <p className="text-sm text-muted-foreground">No agent candidates are available.</p>
      )}
    </>
  );
}
