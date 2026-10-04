import { useEffect, useState } from "react";
import type { AgentConnection } from "../adapters/contract.js";
import { Factory } from "./Factory";
import { ErrorView } from "./ErrorView";
import type { Screen } from "./FactorySidebar";
import { Setup } from "./Setup";
import { api, type FactoryResponse, type ProjectResponse } from "./project-api";
import {
  projectResponseSchema,
  factoryResponseSchema,
  agentsResponseSchema,
  connectionResponseSchema,
} from "./project-api";
import { unavailableCandidates } from "./connection";

export const App = () => {
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [agents, setAgents] = useState<AgentConnection[]>([]);
  const [agentError, setAgentError] = useState("");
  const [counts, setCounts] = useState<FactoryResponse>({ loops: 0, runs: 0 });
  const [error, setError] = useState("");
  const [demo, setDemo] = useState(false);
  const [editing, setEditing] = useState(false);
  const [screen, setScreen] = useState<Screen>("runs");
  const load = async () => {
    try {
      const [nextProject, nextCounts, nextAgents] = await Promise.all([
        api("/api/project", projectResponseSchema.parse),
        api("/api/factory", factoryResponseSchema.parse),
        api("/api/agents", agentsResponseSchema.parse)
          .then((result) => ({ agents: result.agents, error: "" }))
          .catch(() => ({
            agents: unavailableCandidates(),
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
  };
  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);
  if (error) return <ErrorView message={error} onRetry={() => void load()} />;
  if (!project) return <output className="block p-8">Loading local project…</output>;
  if ((!project.project && !demo) || editing)
    return (
      <Setup
        state={project}
        agents={agents}
        agentError={agentError}
        onRefreshAgents={async () => {
          const result = await api("/api/agents", agentsResponseSchema.parse);
          setAgents(result.agents);
          setAgentError("");
        }}
        onConnect={async (request) => {
          const result = await api("/api/agents/connect", connectionResponseSchema.parse, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
          });
          setAgents((previous) =>
            previous.map((item) =>
              item.provider === result.connection.provider ? result.connection : item,
            ),
          );
          return result.connection;
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
      agents={agents}
      counts={counts}
      screen={screen}
      setScreen={setScreen}
      demo={demo}
      onDemo={() => setDemo(true)}
      onExitDemo={() => setDemo(false)}
      onEditSetup={() => setEditing(true)}
    />
  );
};
