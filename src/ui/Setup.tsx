import { useEffect, useRef, useState } from "react";
import type { AgentConnection } from "../adapters/contract.js";
import type { ProviderId } from "../domain/loop.js";
import type { ProjectConfig } from "../runtime/project.js";
import { Button } from "@/components/ui/button";
import { bindingError, connectionViewModel } from "./connection";
import { Brand } from "./Brand";
import { api, type ProjectResponse } from "./project-api";
import { AgentSetupSection } from "./AgentSetupSection";
import { ModelSetupSection } from "./ModelSetupSection";
import { ProjectSetupSection } from "./ProjectSetupSection";

export function Setup({
  state,
  agents,
  agentError,
  onRefreshAgents,
  onConnect,
  onSaved,
  onDemo,
  onCancel,
}: {
  state: ProjectResponse;
  agents: AgentConnection[];
  agentError: string;
  onRefreshAgents: () => Promise<void>;
  onConnect: (
    request:
      | { provider: "codex"; launch: true }
      | { provider: "custom"; launch: true; executable: string; protocol: "codex-app-server" },
  ) => Promise<AgentConnection>;
  onSaved: (state: ProjectResponse) => void;
  onDemo: () => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(state.project?.name ?? "");
  const [selected, setSelected] = useState<ProviderId | null>(
    state.project?.defaultBinding?.provider ?? null,
  );
  const [model, setModel] = useState(state.project?.defaultBinding?.model ?? "agent-default");
  const [effort, setEffort] = useState(state.project?.defaultBinding?.effort ?? "");
  const [customExecutable, setCustomExecutable] = useState(
    state.project?.customAgent?.executable ?? "",
  );
  const [bindingChanged, setBindingChanged] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const displayedAgents: AgentConnection[] = agents.map((item) => {
    if (item.provider !== "custom" || item.executable === customExecutable.trim()) return item;
    return {
      provider: "custom",
      executable: null,
      installation: "missing",
      authentication: "unknown",
      capabilities: { streaming: "unknown", steering: "unknown", resume: "unknown" },
      reason: "Verify the current executable and protocol to connect.",
    };
  });
  const activeConnection = displayedAgents.find((item) => item.provider === selected);
  const active = activeConnection ? connectionViewModel(activeConnection) : undefined;
  const savedBinding = state.project?.defaultBinding;
  const activeModel = activeConnection?.models?.find((item) => item.id === model);
  const availableEfforts = activeModel?.efforts ?? [];
  const draftBinding = selected
    ? { provider: selected, model, ...(effort ? { effort } : {}) }
    : null;
  const validation = bindingError(draftBinding, displayedAgents);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  function selectAgent(provider: ProviderId | null) {
    setSelected(provider);
    setModel("agent-default");
    setEffort("");
    setBindingChanged(true);
    setError("");
  }
  function changeCustomExecutable(value: string) {
    setCustomExecutable(value);
    setModel("agent-default");
    setEffort("");
    setBindingChanged(true);
    setError("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter a project name.");
      nameRef.current?.focus();
      return;
    }
    if (bindingChanged && validation) {
      setError(validation);
      return;
    }
    if (customExecutable.trim() && !customExecutable.trim().startsWith("/")) {
      setError("Enter an absolute custom executable path.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{ project: ProjectConfig; revision: string }>("/api/project/setup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          revision: state.revision,
          ...(bindingChanged ? { defaultBinding: draftBinding } : {}),
          ...(customExecutable.trim()
            ? { customAgent: { executable: customExecutable.trim(), protocol: "codex-app-server" } }
            : {}),
        }),
      });
      onSaved({ ...state, ...result });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save setup. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function refreshAgents() {
    setRefreshing(true);
    setError("");
    try {
      await onRefreshAgents();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not recheck agents. Try again.");
    } finally {
      setRefreshing(false);
    }
  }
  async function verify() {
    if (selected !== "codex" && selected !== "custom") return;
    setVerifying(true);
    setError("");
    try {
      const connection = await onConnect(
        selected === "codex"
          ? { provider: "codex", launch: true }
          : {
              provider: "custom",
              launch: true,
              executable: customExecutable.trim(),
              protocol: "codex-app-server",
            },
      );
      if (selected === "custom" && connection.executable)
        setCustomExecutable(connection.executable);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not verify agent connection.");
    } finally {
      setVerifying(false);
    }
  }
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
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
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
}
