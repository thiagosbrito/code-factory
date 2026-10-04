import type { AgentConnection } from "../adapters/contract.js";
import type { ProviderId } from "../domain/loop.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connectionViewModel } from "./connection";
import { AgentCandidates } from "./AgentCandidates";
import { AgentCapabilities } from "./AgentCapabilities";
import { SetupSection } from "./SetupSection";

export const AgentSetupSection = ({
  displayedAgents,
  agentError,
  selected,
  customExecutable,
  verifying,
  refreshing,
  onSelect,
  onCustomExecutableChange,
  onVerify,
  onRefresh,
}: {
  displayedAgents: AgentConnection[];
  agentError: string;
  selected: ProviderId | null;
  customExecutable: string;
  verifying: boolean;
  refreshing: boolean;
  onSelect: (provider: ProviderId | null) => void;
  onCustomExecutableChange: (value: string) => void;
  onVerify: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) => {
  const models = displayedAgents.map(connectionViewModel);
  const active = models.find((item) => item.id === selected);
  const activeConnection = displayedAgents.find((item) => item.provider === selected);
  return (
    <SetupSection
      number={2}
      title="Coding agent"
      description="Installation, authentication, and capabilities are separate checks"
    >
      <AgentCandidates agents={displayedAgents} selected={selected} onSelect={onSelect} />
      {agentError && <p className="mt-2 text-sm text-red-700">{agentError}</p>}
      {selected === "custom" && (
        <div className="mt-4 grid gap-3 rounded-lg border p-4">
          <label htmlFor="custom-executable" className="grid gap-2 text-sm font-medium">
            Custom executable
            <Input
              id="custom-executable"
              value={customExecutable}
              placeholder="/absolute/path/to/codex"
              onChange={(event) => onCustomExecutableChange(event.target.value)}
            />
          </label>
          <label htmlFor="custom-protocol" className="grid gap-2 text-sm font-medium">
            Protocol
            <select
              id="custom-protocol"
              className="h-10 rounded-md border border-input bg-canvas px-3"
            >
              <option value="codex-app-server">Codex app-server</option>
            </select>
          </label>
          <small className="text-muted-foreground">
            Verification launches this executable only when you choose Verify. It must identify as
            Codex CLI and complete its protocol handshake.
          </small>
        </div>
      )}
      {(selected === "codex" || selected === "custom") && (
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => void onVerify()}
          disabled={verifying || (selected === "custom" && !customExecutable.trim())}
        >
          {verifying ? "Verifying…" : active?.verified ? "Recheck connection" : "Verify connection"}
        </Button>
      )}
      {activeConnection?.authentication === "unauthenticated" && (
        <p className="mt-3 text-sm text-amber-800">
          Authentication required. Run <code>codex login</code> in your terminal, then recheck.
          Credentials stay with Codex.
        </p>
      )}
      {activeConnection && (
        <AgentCapabilities connection={activeConnection} connected={Boolean(active?.connected)} />
      )}
      <Button
        type="button"
        variant="outline"
        className="mt-3"
        onClick={() => void onRefresh()}
        disabled={refreshing}
      >
        {refreshing ? "Rechecking…" : "Recheck agents"}
      </Button>
      <p className="mt-3 text-xs text-muted-foreground">
        Discovery does not launch an agent. Verify only when you intend to connect. You can finish
        without an agent.
      </p>
    </SetupSection>
  );
};
