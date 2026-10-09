import type { AgentConnection } from "../../adapters/contract.js";
import { Button } from "@/shared/components/button";
import { Card } from "@/shared/components/card";
import { bindingError, connectionViewModel } from "../shared/connection";
import type { ProjectResponse } from "../shared/project-api";

export const ProjectSettingsCard = ({
  project,
  agents,
  demo,
  onEditSetup,
}: {
  project: ProjectResponse;
  agents: AgentConnection[];
  demo: boolean;
  onEditSetup: () => void;
}) => {
  const binding = project.project?.defaultBinding ?? null;
  const problem = bindingError(binding, agents);
  return (
    <Card className="mt-7 p-6">
      <h2 className="font-semibold">Project</h2>
      <p className="mt-2 text-sm">{project.project?.name}</p>
      <p className="mt-1 break-all text-sm text-muted-foreground">{project.path}</p>
      <p className="mt-4 text-sm text-muted-foreground">
        Agent execution requires a verified connection. Project setup does not start a run.
      </p>
      <h3 className="mt-6 font-semibold">Coding agents and default model</h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {agents
          .filter((item) => item.provider !== "mock")
          .map((item) => {
            const view = connectionViewModel(item);
            return (
              <div key={item.provider} className="rounded-lg border p-3 text-sm">
                <strong>{view.label}</strong>
                <p className="mt-1 text-xs text-muted-foreground">{view.detail}</p>
              </div>
            );
          })}
      </div>
      <p className="mt-4 text-sm">
        Project default:{" "}
        {binding
          ? `${binding.provider} · ${binding.model}${binding.effort ? ` · ${binding.effort}` : ""}`
          : "Not configured"}
      </p>
      {problem && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {problem}
        </p>
      )}
      {!demo && (
        <Button className="mt-5" variant="outline" onClick={onEditSetup}>
          Edit project setup
        </Button>
      )}
    </Card>
  );
};
