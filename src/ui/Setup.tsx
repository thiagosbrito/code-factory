import { useEffect, useRef, useState } from "react";
import type { AgentConnection } from "../adapters/contract.js";
import type { ProviderId } from "../domain/loop.js";
import type { ProjectConfig } from "../runtime/project.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bindingError, connectionViewModel } from "./connection";
import { Brand } from "./Brand";
import { api, type ProjectResponse } from "./project-api";
import { SetupSection } from "./SetupSection";

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
  const models = displayedAgents.map(connectionViewModel);
  const active = models.find((item) => item.id === selected);
  const savedBinding = state.project?.defaultBinding;
  const activeConnection = displayedAgents.find((item) => item.provider === selected);
  const activeModel = activeConnection?.models?.find((item) => item.id === model);
  const availableEfforts = activeModel?.efforts ?? [];
  const draftBinding = selected
    ? { provider: selected, model, ...(effort ? { effort } : {}) }
    : null;
  const validation = bindingError(draftBinding, displayedAgents);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
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
          <SetupSection
            number={1}
            title="Project"
            description="Local workspace selected when Code Factory started"
          >
            <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
              <label className="grid gap-2 text-sm font-medium" htmlFor="project-name">
                Project name
                <Input
                  ref={nameRef}
                  id="project-name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError("");
                  }}
                  aria-invalid={Boolean(error && !name.trim())}
                  aria-describedby={error ? "setup-error" : undefined}
                  placeholder="my-application"
                />
              </label>
              <div className="grid gap-2 text-sm font-medium">
                <span>Local project path</span>
                <div
                  className="flex min-h-10 items-center overflow-x-auto rounded-md border border-input bg-canvas px-3 text-sm font-normal"
                  aria-label="Canonical project path"
                >
                  {state.path}
                </div>
                <small className="font-normal text-muted-foreground">
                  Validated by the local runtime. Restart with --project to use another workspace.
                </small>
              </div>
            </div>
          </SetupSection>
          <SetupSection
            number={2}
            title="Coding agent"
            description="Installation, authentication, and capabilities are separate checks"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setModel("agent-default");
                  setEffort("");
                  setBindingChanged(true);
                  setError("");
                }}
                aria-pressed={selected === null}
                className={`rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === null ? "border-teal-600 bg-teal-50" : "border-border"}`}
              >
                <span className="block text-sm font-semibold">No default agent</span>
                <span className="text-xs text-muted-foreground">Configure later</span>
              </button>
              {models.map((agent) => (
                <button
                  type="button"
                  key={agent.id}
                  onClick={() => {
                    setSelected(agent.id);
                    setModel("agent-default");
                    setEffort("");
                    setBindingChanged(true);
                    setError("");
                  }}
                  aria-pressed={selected === agent.id}
                  className={`rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === agent.id ? "border-teal-600 bg-teal-50" : "border-border"}`}
                >
                  <span className="block text-sm font-semibold">{agent.label}</span>
                  <span className="block text-xs text-muted-foreground">{agent.detail}</span>
                  <span className="mt-1 block text-xs">
                    {agent.connected
                      ? "Connected"
                      : agent.verified
                        ? "Identity verified"
                        : displayedAgents.find((item) => item.provider === agent.id)
                              ?.installation === "detected"
                          ? "Executable detected"
                          : "Not detected"}
                  </span>
                </button>
              ))}
            </div>
            {models.length === 0 && (
              <p className="text-sm text-muted-foreground">No agent candidates are available.</p>
            )}
            {agentError && <p className="mt-2 text-sm text-red-700">{agentError}</p>}
            {selected === "custom" && (
              <div className="mt-4 grid gap-3 rounded-lg border p-4">
                <label htmlFor="custom-executable" className="grid gap-2 text-sm font-medium">
                  Custom executable
                  <Input
                    id="custom-executable"
                    value={customExecutable}
                    placeholder="/absolute/path/to/codex"
                    onChange={(event) => {
                      setCustomExecutable(event.target.value);
                      setModel("agent-default");
                      setEffort("");
                      setBindingChanged(true);
                      setError("");
                    }}
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
                  Verification launches this executable only when you choose Verify. It must
                  identify as Codex CLI and complete its protocol handshake.
                </small>
              </div>
            )}
            {(selected === "codex" || selected === "custom") && (
              <Button
                type="button"
                variant="outline"
                className="mt-3"
                onClick={() => void verify()}
                disabled={verifying || (selected === "custom" && !customExecutable.trim())}
              >
                {verifying
                  ? "Verifying…"
                  : active?.verified
                    ? "Recheck connection"
                    : "Verify connection"}
              </Button>
            )}
            {activeConnection?.authentication === "unauthenticated" && (
              <p className="mt-3 text-sm text-amber-800">
                Authentication required. Run <code>codex login</code> in your terminal, then
                recheck. Credentials stay with Codex.
              </p>
            )}
            {activeConnection && (
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {(["streaming", "steering", "resume"] as const).map((capability) => (
                  <div key={capability} className="rounded-lg border p-3 text-sm">
                    <strong className="block capitalize">
                      {capability === "steering"
                        ? "Guidance"
                        : capability === "resume"
                          ? "Recovery"
                          : capability}
                    </strong>
                    <span className="text-xs text-muted-foreground">
                      {activeConnection.capabilities[capability] === "supported" &&
                      active?.connected
                        ? "Available"
                        : activeConnection.capabilities[capability] === "unsupported"
                          ? "Unsupported"
                          : activeConnection.authentication === "unauthenticated"
                            ? "Authentication required"
                            : active?.connected
                              ? "Unknown for this connection"
                              : "Unavailable until connected"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => void refreshAgents()}
              disabled={refreshing}
            >
              {refreshing ? "Rechecking…" : "Recheck agents"}
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              Discovery does not launch an agent. Verify only when you intend to connect. You can
              finish without an agent.
            </p>
          </SetupSection>
          <SetupSection
            number={3}
            title="Default model"
            description="Used for future runs; existing run snapshots retain their bindings"
          >
            <label htmlFor="default-model" className="grid max-w-sm gap-2 text-sm font-medium">
              Project default model
              <select
                id="default-model"
                aria-label="Project default model"
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                  setEffort("");
                  setBindingChanged(true);
                }}
                disabled={!active?.connected}
                className="h-10 rounded-md border border-input bg-canvas px-3 text-sm font-normal text-muted-foreground"
              >
                <option value="agent-default">Agent default</option>
                {active?.models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
                {model !== "agent-default" && !active?.models.some((item) => item.id === model) && (
                  <option value={model}>{model} (unavailable)</option>
                )}
              </select>
              <small className="font-normal text-muted-foreground">
                {active?.connected
                  ? "Models come from this connection's catalog; listing does not guarantee entitlement."
                  : savedBinding
                    ? "Saved default is retained until you change it."
                    : "Connect an agent to load its catalog."}
              </small>
            </label>
            {availableEfforts.length > 0 && (
              <label
                htmlFor="default-effort"
                className="mt-4 grid max-w-sm gap-2 text-sm font-medium"
              >
                Effort
                <select
                  id="default-effort"
                  value={effort}
                  onChange={(event) => {
                    setEffort(event.target.value);
                    setBindingChanged(true);
                  }}
                  className="h-10 rounded-md border border-input bg-canvas px-3"
                >
                  <option value="">Agent default</option>
                  {availableEfforts.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {validation && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {validation}
              </p>
            )}
          </SetupSection>
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
