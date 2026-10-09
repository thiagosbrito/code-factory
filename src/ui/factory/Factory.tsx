import { useEffect, useRef, useState } from "react";
import type { AgentConnection } from "../../adapters/contract.js";
import { Loops } from "../features/loops/Loops";
import { useFactoryRuns } from "../features/runs/useFactoryRuns";
import type { FactoryResponse, ProjectPatch, ProjectResponse } from "../shared/project-api";
import { DemoPlaceholder } from "./DemoPlaceholder";
import { FactoryDialogs } from "./FactoryDialogs";
import { FactoryPageHeader } from "./FactoryPageHeader";
import { FactorySidebar, type Screen } from "./FactorySidebar";
import { ProjectSettingsCard } from "./ProjectSettingsCard";
import { RunsScreen } from "./RunsScreen";
import { SelectedRunDetail } from "./SelectedRunDetail";

export const Factory = ({
  project,
  agents,
  counts,
  screen,
  setScreen,
  demo,
  onDemo,
  onExitDemo,
  onEditSetup,
  onProjectChanged,
}: {
  onProjectChanged?: (next: ProjectPatch) => void;
  project: ProjectResponse;
  agents: AgentConnection[];
  counts: FactoryResponse;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  demo: boolean;
  onDemo: () => void;
  onExitDemo: () => void;
  onEditSetup: () => void;
}) => {
  const [newRunOpen, setNewRunOpen] = useState(false);
  const factory = useFactoryRuns(demo, onProjectChanged ? { onProjectChanged } : {});
  const { notice, setNotice, setPublishedLoops, runs } = factory;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [screen]);
  const showCreate = () => {
    setScreen("loops");
    setNotice("");
  };
  const showTemplate = () => {
    setScreen("loops");
    setNotice("Choose a starter in the loops library to create a draft.");
  };
  return (
    <div className="min-h-screen bg-canvas md:flex">
      <FactorySidebar
        projectName={demo ? "Demo factory" : (project.project?.name ?? "Project")}
        screen={screen}
        setScreen={(next) => {
          setScreen(next);
          setNotice("");
        }}
        runs={demo ? 2 : runs.length}
        demo={demo}
        onExitDemo={onExitDemo}
      />
      <main className="min-w-0 flex-1 p-6 md:p-10">
        <FactoryPageHeader
          screen={screen}
          demo={demo}
          notice={notice}
          headingRef={headingRef}
          onNewRun={() => setNewRunOpen(true)}
          onDemo={onDemo}
        />
        {screen === "loops" && !demo ? (
          <Loops
            project={project}
            agents={agents}
            onPublished={(loop) =>
              setPublishedLoops((previous) => [
                loop,
                ...previous.filter((item) => item.id !== loop.id),
              ])
            }
          />
        ) : screen === "settings" ? (
          <ProjectSettingsCard
            project={project}
            agents={agents}
            demo={demo}
            onEditSetup={onEditSetup}
          />
        ) : demo ? (
          <DemoPlaceholder screen={screen} />
        ) : (
          <RunsScreen
            factory={factory}
            counts={counts}
            renderSelected={(run, onBack) => (
              <SelectedRunDetail run={run} factory={factory} agents={agents} onBack={onBack} />
            )}
            onCreate={showCreate}
            onTemplate={showTemplate}
          />
        )}
        <FactoryDialogs
          project={project}
          agents={agents}
          demo={demo}
          factory={factory}
          newRunOpen={newRunOpen}
          onNewRunOpenChange={setNewRunOpen}
          headingRef={headingRef}
        />
      </main>
    </div>
  );
};
