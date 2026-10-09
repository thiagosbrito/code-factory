import { useEffect, useRef, useState } from "react";
import type { AgentConnection } from "../adapters/contract.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { FactoryResponse, ProjectPatch, ProjectResponse } from "./project-api";
import { ToolGrantDialog } from "./ToolGrantDialog";
import { TrustDialog } from "./TrustDialog";
import { FactoryEmptyState } from "./FactoryEmptyState";
import { FactorySidebar, screenLabels, type Screen } from "./FactorySidebar";
import { bindingError, connectionViewModel } from "./connection";
import { Loops } from "./Loops";
import { NewRunDialog } from "./NewRunDialog";
import { RunDetail } from "./RunDetail";
import { RunsList } from "./RunsList";
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
    retry,
    sendGuidance,
    replyToInput,
    accept,
    accepting,
    evidenceSummary,
    executingRunId,
    connected,
    streamConnected,
    historyState,
    historyError,
    reload,
    selectedRunId,
    workspace,
    promote,
    removeWorktree,
    returnCheckout,
    toolGrantPrompt,
    answerToolGrant,
    toolGrantReturnFocus,
    trustPrompt,
    answerTrust,
    selectedRunInterrupted,
  } = useFactoryRuns(demo, onProjectChanged ? { onProjectChanged } : {});
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
          <RunDetail
            key={selectedRun.snapshot.id}
            run={selectedRun}
            summary={evidenceSummary}
            accepting={accepting}
            onAccept={() => void accept(selectedRun.snapshot.id)}
            connected={connected}
            streamConnected={streamConnected}
            executing={executingRunId === selectedRun.snapshot.id}
            interrupted={selectedRunInterrupted}
            onExecute={() => void execute(selectedRun.snapshot.id)}
            onCancel={() => void cancel(selectedRun.snapshot.id)}
            agents={agents}
            onRetry={(stepId, attemptId, focusTarget) =>
              void retry(selectedRun.snapshot.id, stepId, attemptId, focusTarget ?? undefined)
            }
            workspace={workspace}
            onPromote={(name) => promote(selectedRun.snapshot.id, name)}
            onRemoveWorktree={() => removeWorktree(selectedRun.snapshot.id)}
            onReturnCheckout={() => returnCheckout(selectedRun.snapshot.id)}
            onSendGuidance={(input) => sendGuidance(selectedRun.snapshot.id, input)}
            onReplyToInput={(input) => replyToInput(selectedRun.snapshot.id, input)}
            onBack={() => {
              setSelectedRunId("");
              window.history.pushState(null, "", "#runs");
            }}
          />
        ) : screen === "runs" && historyState === "loading" ? (
          <output className="mt-7 block text-sm">Loading run history…</output>
        ) : screen === "runs" && historyState === "error" ? (
          <Card className="mt-7 p-6" role="alert">
            <h2 className="font-semibold">Could not load run history</h2>
            <p className="mt-2 text-sm">{historyError}</p>
            <Button className="mt-4" onClick={reload}>
              Retry
            </Button>
          </Card>
        ) : screen === "runs" && selectedRunId && connected ? (
          <output className="mt-7 block text-sm">Loading selected run…</output>
        ) : screen === "runs" && selectedRunId ? (
          <Card className="mt-7 p-6" role="alert">
            <h2 className="font-semibold">Run unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The selected run could not be loaded from the local runtime.
            </p>
            <Button className="mt-4 mr-2" onClick={reload}>
              Reconnect
            </Button>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => {
                setSelectedRunId("");
                window.history.pushState(null, "", "#runs");
              }}
            >
              All runs
            </Button>
          </Card>
        ) : screen === "runs" && runs.length > 0 ? (
          <>
            <p className="mt-5 text-xs text-muted-foreground">
              {connected ? "Local runtime connected" : "Disconnected · saved history may be stale"}
            </p>
            <RunsList runs={runs} onOpen={openRun} />
          </>
        ) : screen === "runs" && !connected ? (
          <Card className="mt-7 p-6" role="alert">
            <h2 className="font-semibold">Runtime disconnected</h2>
            <p className="mt-2 text-sm">
              Run history is unavailable until the local runtime reconnects.
            </p>
            <Button className="mt-4" onClick={reload}>
              Reconnect
            </Button>
          </Card>
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
        <ToolGrantDialog
          mode="run"
          prompt={toolGrantPrompt}
          onAnswer={(choice) => void answerToolGrant(choice)}
          returnFocus={toolGrantReturnFocus}
          fallbackFocus={headingRef}
        />
        <TrustDialog
          prompt={trustPrompt}
          onAnswer={(choice) => void answerTrust(choice)}
          returnFocus={toolGrantReturnFocus}
          fallbackFocus={headingRef}
        />
      </main>
    </div>
  );
};
