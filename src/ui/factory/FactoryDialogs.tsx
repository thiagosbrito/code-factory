import type { RefObject } from "react";
import type { AgentConnection } from "../../adapters/contract.js";
import type { FactoryRuns } from "../features/runs/useFactoryRuns";
import { bindingError } from "../shared/connection";
import type { ProjectResponse } from "../shared/project-api";
import { ToolGrantDialog } from "../shared/ToolGrantDialog";
import { TrustDialog } from "../shared/TrustDialog";
import { NewRunDialog } from "./NewRunDialog";

/** The new-run dialog and the tool-grant and trust prompts raised while a run executes. */
export const FactoryDialogs = ({
  project,
  agents,
  demo,
  factory,
  newRunOpen,
  onNewRunOpenChange,
  headingRef,
}: {
  project: ProjectResponse;
  agents: AgentConnection[];
  demo: boolean;
  factory: FactoryRuns;
  newRunOpen: boolean;
  onNewRunOpenChange: (open: boolean) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) => {
  const defaultBinding = project.project?.defaultBinding ?? null;
  return (
    <>
      {!demo && (
        <NewRunDialog
          open={newRunOpen}
          onOpenChange={onNewRunOpenChange}
          projectName={project.project?.name ?? "Project"}
          loops={factory.publishedLoops}
          trackerConfigured={factory.trackerConfigured}
          canStart={Boolean(defaultBinding && !bindingError(defaultBinding, agents))}
          agents={agents}
          defaultBinding={defaultBinding}
          onStarted={factory.onStarted}
        />
      )}
      <ToolGrantDialog
        mode="run"
        prompt={factory.toolGrantPrompt}
        onAnswer={(choice) => void factory.answerToolGrant(choice)}
        returnFocus={factory.toolGrantReturnFocus}
        fallbackFocus={headingRef}
      />
      <TrustDialog
        prompt={factory.trustPrompt}
        onAnswer={(choice) => void factory.answerTrust(choice)}
        returnFocus={factory.toolGrantReturnFocus}
        fallbackFocus={headingRef}
      />
    </>
  );
};
