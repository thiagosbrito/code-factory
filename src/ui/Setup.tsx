import { useEffect, useRef, useState } from "react";
import type { AgentConnection } from "../adapters/contract.js";
import type { ProjectConfig } from "../runtime/project.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { connectionViewModel } from "./connection";
import { Brand } from "./Brand";
import { api, type ProjectResponse } from "./project-api";

function Section({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-teal-50 text-sm font-semibold text-teal-700">
          {number}
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </Card>
  );
}

export function Setup({
  state,
  agents,
  agentError,
  onRefreshAgents,
  onSaved,
  onDemo,
  onCancel,
}: {
  state: ProjectResponse;
  agents: AgentConnection[];
  agentError: string;
  onRefreshAgents: () => Promise<void>;
  onSaved: (state: ProjectResponse) => void;
  onDemo: () => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(state.project?.name ?? "");
  const [selected, setSelected] = useState<string | null>(
    state.project?.defaultBinding?.provider ?? null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const models = agents.map(connectionViewModel);
  const active = models.find((item) => item.id === selected);
  const savedBinding = state.project?.defaultBinding;
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
    setBusy(true);
    setError("");
    try {
      const result = await api<{ project: ProjectConfig; revision: string }>("/api/project/setup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), revision: state.revision }),
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
          <Section
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
          </Section>
          <Section
            number={2}
            title="Coding agent"
            description="Installation, authentication, and capabilities are separate checks"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {models.map((agent) => (
                <button
                  type="button"
                  key={agent.id}
                  onClick={() => setSelected(agent.id)}
                  aria-pressed={selected === agent.id}
                  className={`rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === agent.id ? "border-teal-600 bg-teal-50" : "border-border"}`}
                >
                  <span className="block text-sm font-semibold">{agent.label}</span>
                  <span className="text-xs text-muted-foreground">{agent.detail}</span>
                </button>
              ))}
            </div>
            {models.length === 0 && (
              <p className="text-sm text-muted-foreground">No agent candidates are available.</p>
            )}
            {agentError && <p className="mt-2 text-sm text-red-700">{agentError}</p>}
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
              Selection here is a preview. Connection setup and binding are managed by the
              connection flow. You can finish without an agent.
            </p>
          </Section>
          <Section
            number={3}
            title="Default model"
            description="Used for future work when a verified connection is configured"
          >
            <label htmlFor="default-model" className="grid max-w-sm gap-2 text-sm font-medium">
              Project default model
              <select
                id="default-model"
                aria-label="Project default model"
                disabled
                className="h-10 rounded-md border border-input bg-canvas px-3 text-sm font-normal text-muted-foreground"
              >
                <option>
                  {savedBinding
                    ? `${savedBinding.provider} · ${savedBinding.model} (saved)`
                    : active?.verified && active.models.length
                      ? "Select in connection settings"
                      : "Connect an agent to load models"}
                </option>
              </select>
              <small className="font-normal text-muted-foreground">
                {savedBinding
                  ? "Saved default is retained. Verify connection availability before execution."
                  : "Model choices come from the verified agent catalog. No model is selected yet."}
              </small>
            </label>
          </Section>
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
