import { useEffect, useRef, useState } from "react";
import type { AgentConnection } from "../adapters/contract.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { FactoryResponse, ProjectResponse } from "./project-api";
import { FactoryEmptyState } from "./FactoryEmptyState";
import { FactorySidebar, screenLabels, type Screen } from "./FactorySidebar";
import { bindingError, connectionViewModel } from "./connection";
import { Loops } from "./Loops";
import { NewRunDialog } from "./NewRunDialog";
import { RunExecution } from "./RunExecution";
import { useFactoryRuns } from "./useFactoryRuns";

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
}: {
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
  const {
    notice,
    setNotice,
    publishedLoops,
    setPublishedLoops,
    runs,
    trackerConfigured,
    selectedRun,
    setSelectedRunId,
    openRun,
    onStarted,
    execute,
    cancel,
    executingRunId,
    connected,
  } = useFactoryRuns(demo);
  const canStart = Boolean(
    project.project?.defaultBinding && !bindingError(project.project.defaultBinding, agents),
  );
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
    setNotice(
      "Starter templates become available when the optional template library is installed.",
    );
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
      <main className="w-full flex-1 p-6 md:p-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-semibold tracking-tight">
              {screenLabels[screen]}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {screen === "runs"
                ? "Launch and review repeatable coding work."
                : screen === "loops"
                  ? "Reusable local workflows for future runs."
                  : "Project and connection settings"}
            </p>
          </div>
          {!demo && (
            <div className="flex gap-2">
              {screen === "runs" && <Button onClick={() => setNewRunOpen(true)}>New run</Button>}
              <Button variant="outline" onClick={onDemo}>
                Open demo factory
              </Button>
            </div>
          )}
        </div>
        {demo && (
          <p className="mt-6 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm">
            Demo factory · Sample content is separate from your project and is never saved.
          </p>
        )}
        {notice && (
          <output className="mt-5 block rounded-md border bg-white p-3 text-sm">{notice}</output>
        )}
        {screen === "loops" && !demo ? (
          <Loops
            project={project}
            agents={agents}
            onTemplate={showTemplate}
            onPublished={(loop) =>
              setPublishedLoops((previous) => [
                loop,
                ...previous.filter((item) => item.id !== loop.id),
              ])
            }
          />
        ) : screen === "settings" ? (
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
              {project.project?.defaultBinding
                ? `${project.project.defaultBinding.provider} · ${project.project.defaultBinding.model}${project.project.defaultBinding.effort ? ` · ${project.project.defaultBinding.effort}` : ""}`
                : "Not configured"}
            </p>
            {bindingError(project.project?.defaultBinding ?? null, agents) && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {bindingError(project.project?.defaultBinding ?? null, agents)}
              </p>
            )}
            {!demo && (
              <Button className="mt-5" variant="outline" onClick={onEditSetup}>
                Edit project setup
              </Button>
            )}
          </Card>
        ) : demo ? (
          <Card className="mt-7 p-8">
            <h2 className="text-lg font-semibold">Sample {screen}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Explore the layout without creating project history.
            </p>
          </Card>
        ) : screen === "runs" && selectedRun ? (
          <Card className="mt-7 p-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedRunId("");
                window.history.pushState(null, "", "#runs");
              }}
            >
              ← All runs
            </Button>
            <h2 className="mt-5 text-xl font-semibold">
              {selectedRun.snapshot.task.ticket?.title ??
                selectedRun.snapshot.task.description.slice(0, 80)}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Run {selectedRun.snapshot.id} · {selectedRun.status}
            </p>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium">Project</dt>
                <dd>{project.project?.name}</dd>
              </div>
              <div>
                <dt className="font-medium">Loop</dt>
                <dd>
                  {selectedRun.snapshot.loop.name} · v{selectedRun.snapshot.loop.version}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Git baseline</dt>
                <dd className="break-all font-mono text-xs">
                  {selectedRun.snapshot.baseline.revision}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Isolated workspace</dt>
                <dd className="break-all text-xs">{selectedRun.snapshot.baseline.workspace}</dd>
              </div>
            </dl>
            {selectedRun.snapshot.task.description && (
              <section className="mt-6">
                <h3 className="font-medium">Description</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {selectedRun.snapshot.task.description}
                </p>
              </section>
            )}
            {selectedRun.snapshot.task.ticket && (
              <section className="mt-6">
                <h3 className="font-medium">
                  Retrieved ticket · {selectedRun.snapshot.task.ticket.id}
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {selectedRun.snapshot.task.ticket.summary}
                </p>
                <ul className="mt-2 list-inside list-disc text-sm">
                  {selectedRun.snapshot.task.ticket.attachments.map((attachment) => (
                    <li key={attachment.url}>{attachment.title}</li>
                  ))}
                </ul>
              </section>
            )}
            <RunExecution
              run={selectedRun}
              executing={executingRunId === selectedRun.snapshot.id}
              connected={connected}
              onExecute={() => void execute(selectedRun.snapshot.id)}
              onCancel={() => void cancel(selectedRun.snapshot.id)}
            />
          </Card>
        ) : screen === "runs" && runs.length > 0 ? (
          <div className="mt-7 space-y-2">
            {runs.map((run) => (
              <button
                key={run.snapshot.id}
                onClick={() => openRun(run.snapshot.id)}
                className="block w-full rounded-lg border bg-white p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <strong>
                  {run.snapshot.task.ticket?.title ?? run.snapshot.task.description.slice(0, 80)}
                </strong>
                <span className="ml-3 text-xs text-muted-foreground">{run.status}</span>
                <p className="mt-1 text-xs text-muted-foreground">
                  {run.snapshot.loop.name} v{run.snapshot.loop.version} · {run.snapshot.id}
                </p>
              </button>
            ))}
          </div>
        ) : counts[screen] === 0 ? (
          <FactoryEmptyState kind={screen} onCreate={showCreate} onTemplate={showTemplate} />
        ) : (
          <Card className="mt-7 p-6">
            <h2 className="font-semibold">
              {counts[screen]} saved {screen}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Saved items will be listed when the {screen} view is connected.
            </p>
          </Card>
        )}
        {!demo && (
          <NewRunDialog
            open={newRunOpen}
            onOpenChange={setNewRunOpen}
            projectName={project.project?.name ?? "Project"}
            loops={publishedLoops}
            trackerConfigured={trackerConfigured}
            canStart={canStart}
            agents={agents}
            defaultBinding={project.project?.defaultBinding ?? null}
            onStarted={onStarted}
          />
        )}
      </main>
    </div>
  );
};
