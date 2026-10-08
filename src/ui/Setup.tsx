import type { AgentConnection } from "../adapters/contract.js";
import { Button } from "@/components/ui/button";
import { Brand } from "./Brand";
import type { ProjectResponse, SavedProjectResponse } from "./project-api";
import { ToolPermissionsSection } from "./ToolPermissionsSection";
import { AgentSetupSection } from "./AgentSetupSection";
import { ModelSetupSection } from "./ModelSetupSection";
import { ProjectSetupSection } from "./ProjectSetupSection";
import { useSetupController } from "./useSetupController";

export const Setup = ({
  state,
  agents,
  agentError,
  onRefreshAgents,
  onConnect,
  onSaved,
  onDemo,
  onCancel,
  onProjectChanged = () => undefined,
}: {
  onProjectChanged?: (next: SavedProjectResponse) => void;
  state: ProjectResponse;
  agents: AgentConnection[];
  agentError: string;
  onRefreshAgents: () => Promise<void>;
  onConnect: (
    request:
      | { provider: "codex"; launch: true }
      | { provider: "kiro"; launch: true }
      | { provider: "custom"; launch: true; executable: string; protocol: "codex-app-server" },
  ) => Promise<AgentConnection>;
  onSaved: (state: ProjectResponse) => void;
  onDemo: () => void;
  onCancel?: () => void;
}) => {
  const {
    setupCommand,
    setSetupCommand,
    name,
    setName,
    selected,
    model,
    setModel,
    effort,
    setEffort,
    customExecutable,
    setBindingChanged,
    verifying,
    error,
    setError,
    busy,
    refreshing,
    nameRef,
    displayedAgents,
    active,
    savedBinding,
    availableEfforts,
    validation,
    selectAgent,
    changeCustomExecutable,
    save,
    refreshAgents,
    verify,
  } = useSetupController({ state, agents, onRefreshAgents, onConnect, onSaved });
  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[280px_1fr]">
      <aside className="flex flex-col bg-graphite p-7 text-white">
        <Brand />
        <div className="mt-14">
          <h2 className="text-xl font-semibold">Local agent factory</h2>
          <p className="mt-3 text-sm leading-6 text-stone-300">
            Configure your local project. Agent connections and models become available after
            verification.
          </p>
        </div>
        <span className="mt-auto pt-8 text-xs text-stone-400">
          {onCancel ? "Project setup" : "First-use setup"}
        </span>
      </aside>
      <main className="mx-auto w-full max-w-4xl px-5 py-10 lg:px-10">
        <p className="text-xs font-semibold tracking-[.18em] text-teal-700">LOCAL FACTORY SETUP</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {onCancel ? "Edit project setup" : "Connect your first project"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This runtime is attached to the CLI-selected workspace. Setup saves its display name under
          .code-factory.
        </p>
        <form onSubmit={(event) => void save(event)} className="mt-7 space-y-4">
          <ProjectSetupSection
            statePath={state.path}
            name={name}
            nameRef={nameRef}
            error={error}
            onNameChange={(value) => {
              setName(value);
              setError("");
            }}
            setupCommand={setupCommand}
            onSetupCommandChange={(value) => {
              setSetupCommand(value);
              setError("");
            }}
          />
          <AgentSetupSection
            displayedAgents={displayedAgents}
            agentError={agentError}
            selected={selected}
            customExecutable={customExecutable}
            verifying={verifying}
            refreshing={refreshing}
            onSelect={selectAgent}
            onCustomExecutableChange={changeCustomExecutable}
            onVerify={verify}
            onRefresh={refreshAgents}
          />
          {state.project && (
            <ToolPermissionsSection state={state} onProjectChanged={onProjectChanged} />
          )}
          <ModelSetupSection
            active={active}
            model={model}
            effort={effort}
            availableEfforts={availableEfforts}
            hasSavedBinding={Boolean(savedBinding)}
            validation={validation}
            onModelChange={(value) => {
              setModel(value);
              setEffort("");
              setBindingChanged(true);
            }}
            onEffortChange={(value) => {
              setEffort(value);
              setBindingChanged(true);
            }}
          />
          {error && (
            <p
              id="setup-error"
              role="alert"
              className="whitespace-pre-wrap break-words rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {onCancel ? (
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={onDemo}>
                Open demo factory
              </Button>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : onCancel ? "Save project" : "Finish setup"}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
};
