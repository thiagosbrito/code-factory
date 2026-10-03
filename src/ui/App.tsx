import { useEffect, useState } from "react";
import type { AgentConnection } from "../adapters/contract.js";
import { Button } from "@/components/ui/button";
import { Factory, type Screen } from "./Factory";
import { Setup } from "./Setup";
import { api, type FactoryResponse, type ProjectResponse } from "./project-api";

export function App() {
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [agents, setAgents] = useState<AgentConnection[]>([]);
  const [agentError, setAgentError] = useState("");
  const [counts, setCounts] = useState<FactoryResponse>({ loops: 0, runs: 0 });
  const [error, setError] = useState("");
  const [demo, setDemo] = useState(false);
  const [editing, setEditing] = useState(false);
  const [screen, setScreen] = useState<Screen>("runs");
  async function load() {
    try {
      const [nextProject, nextCounts, nextAgents] = await Promise.all([
        api<ProjectResponse>("/api/project"),
        api<FactoryResponse>("/api/factory"),
        api<{ agents: AgentConnection[] }>("/api/agents")
          .then((result) => ({ agents: result.agents, error: "" }))
          .catch(() => ({
            agents: [] as AgentConnection[],
            error: "Agent discovery is unavailable. You can finish setup and recheck later.",
          })),
      ]);
      setProject(nextProject);
      setCounts(nextCounts);
      setAgents(nextAgents.agents);
      setAgentError(nextAgents.error);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load local runtime.");
    }
  }
  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);
  if (error)
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-2xl font-semibold">Cannot open project</h1>
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
        <Button className="mt-5" onClick={() => void load()}>
          Retry
        </Button>
      </main>
    );
  if (!project) return <output className="block p-8">Loading local project…</output>;
  if ((!project.project && !demo) || editing)
    return (
      <Setup
        state={project}
        agents={agents}
        agentError={agentError}
        onRefreshAgents={async () => {
          const result = await api<{ agents: AgentConnection[] }>("/api/agents");
          setAgents(result.agents);
          setAgentError("");
        }}
        onSaved={(next) => {
          setProject(next);
          setEditing(false);
        }}
        onDemo={() => setDemo(true)}
        {...(project.project ? { onCancel: () => setEditing(false) } : {})}
      />
    );
  return (
    <Factory
      project={project}
      counts={counts}
      screen={screen}
      setScreen={setScreen}
      demo={demo}
      onDemo={() => setDemo(true)}
      onExitDemo={() => setDemo(false)}
      onEditSetup={() => setEditing(true)}
    />
  );
}
