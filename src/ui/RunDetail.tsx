import { useId, useRef, useState } from "react";
import { hasRetryBudget, type RunRecord } from "../domain/run.js";
import type { EvidenceSummary } from "../domain/acceptance.js";
import type { AgentConnection } from "../adapters/contract.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { BranchIcon, DescriptionIcon, EvidenceIcon, PlayIcon, StopIcon } from "./icons";
import { RunEvidenceSummary } from "./RunEvidenceSummary";
import { RunGraph } from "./RunGraph";
import { RunInspector } from "./RunInspector";
import { RunInputPrompt } from "./RunInputPrompt";
import { RunStopBanner } from "./RunStopBanner";
import { RunWorkspacePanel } from "./RunWorkspacePanel";
import type { PromoteFailure } from "./PromoteRunDialog";
import type { RunWorkspace } from "../domain/run-branch.js";
import {
  runStatusLabel,
  runStopCause,
  runTitle,
  trackerConnectionStep,
  type RunScope,
} from "./run-view-model";

type RunPanel = "description" | "branch" | "evidence";
const RUN_PANELS: { id: RunPanel; label: string; icon: React.ReactNode }[] = [
  { id: "description", label: "Description", icon: <DescriptionIcon /> },
  { id: "branch", label: "Run branch", icon: <BranchIcon /> },
  { id: "evidence", label: "Final evidence summary", icon: <EvidenceIcon /> },
];

export const RunDetail = ({
  run,
  summary,
  accepting,
  onAccept,
  connected,
  streamConnected,
  executing,
  onExecute,
  onCancel,
  onRetry,
  agents = [],
  onBack,
  onSendGuidance = async () => undefined,
  onReplyToInput = async () => undefined,
  workspace = null,
  onPromote = async () => ({ error: "Promotion is unavailable." }),
  onRemoveWorktree = async () => "Worktree removal is unavailable.",
  onReturnCheckout = async () => "Switching back is unavailable.",
}: {
  workspace?: RunWorkspace | null;
  onPromote?: (name: string) => Promise<PromoteFailure | { warning?: string }>;
  onRemoveWorktree?: () => Promise<string | null>;
  onReturnCheckout?: () => Promise<string | null>;
  run: RunRecord;
  summary: EvidenceSummary | null;
  accepting: boolean;
  onAccept: () => void;
  connected: boolean;
  streamConnected?: boolean | null;
  executing: boolean;
  onExecute: () => void;
  onCancel: () => void;
  onRetry?: (stepId: string, attemptId: string, focusTarget?: HTMLElement | null) => void;
  agents?: AgentConnection[];
  onBack: () => void;
  onSendGuidance?: (input: { stepId: string; attemptId: string; message: string }) => Promise<void>;
  onReplyToInput?: (input: {
    stepId: string;
    attemptId: string;
    requestEvidenceId: string;
    answers: Record<string, { answers: string[] }>;
  }) => Promise<void>;
}) => {
  const [scope, setScope] = useState<RunScope | null>(null);
  const [initialTab, setInitialTab] = useState<"Activity" | "Files" | "Artifacts">("Activity");
  const trigger = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [panel, setPanel] = useState<RunPanel | null>(null);
  const panelTriggers = useRef<Partial<Record<RunPanel, HTMLButtonElement | null>>>({});
  const open = (
    next: RunScope,
    tab: "Activity" | "Files" | "Artifacts" = "Activity",
    returnTo: HTMLElement | null = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  ) => {
    trigger.current = returnTo;
    setInitialTab(tab);
    setScope(next);
  };
  const close = () => {
    setScope(null);
    window.requestAnimationFrame(() => trigger.current?.focus());
  };
  const active = run.steps.filter((step) => step.status === "running").length;
  const complete = run.steps.filter((step) => step.status === "succeeded").length;
  /** From the evidence dialog: close it, then open the run inspector, returning focus to its icon. */
  const handingOff = useRef(false);
  /** Closing a detail dialog returns focus to its icon, unless it handed off to the inspector. */
  const returnFocus = (id: RunPanel) => (event: Event) => {
    event.preventDefault();
    if (handingOff.current) handingOff.current = false;
    else panelTriggers.current[id]?.focus();
  };
  const openFromEvidence = (tab: "Files" | "Artifacts") => {
    handingOff.current = true;
    setPanel(null);
    open({ kind: "run" }, tab, panelTriggers.current.evidence ?? null);
  };
  const acceptable = summary?.validation === "passed" && summary.acceptance !== "accepted";
  const connectionHeadingId = useId();
  // Computed once per render and shared by the status label and the banner.
  const connectionStep = trackerConnectionStep(run);
  const connectionProvider = connectionStep
    ? run.snapshot.bindings[connectionStep.stepId]?.provider
    : undefined;
  const connectionAgentName =
    connectionProvider === "codex"
      ? "Codex"
      : connectionProvider === "kiro"
        ? "Kiro"
        : connectionProvider;
  const connectionAttempt = connectionStep?.attempts.at(-1);
  const connectionRetryAvailable = connectionStep ? hasRetryBudget(run, connectionStep) : false;
  // At most one banner: the tracker-connection banner already explains a failed issue lookup.
  const stopCause = connectionStep ? undefined : runStopCause(run);
  const canCancel =
    connected &&
    (executing || ["pending", "running", "waiting-input", "paused"].includes(run.status));
  const runControls = (
    <div className="flex items-center gap-1">
      {(run.status === "pending" || canCancel) && (
        <div className="flex items-center gap-1 border-r pr-1">
          {run.status === "pending" && (
            <Button
              size="sm"
              aria-label="Execute run"
              title={executing ? "Executing…" : "Execute run"}
              aria-busy={executing || undefined}
              className="h-9 w-9 p-0"
              disabled={executing || !connected}
              onClick={onExecute}
            >
              <PlayIcon />
            </Button>
          )}
          {canCancel && (
            <Button
              size="sm"
              variant="outline"
              aria-label="Cancel run"
              title="Cancel run"
              className="h-9 w-9 p-0 text-red-700"
              onClick={onCancel}
            >
              <StopIcon />
            </Button>
          )}
        </div>
      )}
      <nav aria-label="Run details" className="flex items-center gap-1">
        {RUN_PANELS.filter((item) => item.id !== "branch" || workspace).map((item) => (
          <Button
            key={item.id}
            ref={(element) => {
              panelTriggers.current[item.id] = element;
            }}
            variant="ghost"
            size="sm"
            aria-label={item.label}
            title={item.label}
            className="relative h-9 w-9 p-0"
            onClick={() => setPanel(item.id)}
          >
            {item.icon}
            {item.id === "evidence" && (acceptable || summary?.acceptance === "accepted") && (
              <span
                aria-hidden="true"
                className={`absolute right-1 top-1 h-2 w-2 rounded-full ${acceptable ? "bg-amber-500" : "bg-emerald-600"}`}
              />
            )}
          </Button>
        ))}
      </nav>
    </div>
  );
  return (
    <div className="mt-7 space-y-5">
      <header className="sticky top-0 z-20 -mx-2 rounded-lg border bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}>
            ← All runs
          </Button>
          <div className="min-w-0 flex-1">
            <h2
              ref={titleRef}
              tabIndex={-1}
              className="truncate text-lg font-semibold"
              title={runTitle(run)}
            >
              {runTitle(run)}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-semibold uppercase tracking-wide text-primary">
                {run.snapshot.task.ticket?.id ?? run.snapshot.task.ticketId ?? "Description only"}
              </span>{" "}
              · {run.snapshot.loop.name} v{run.snapshot.loop.version} · round{" "}
              {run.implementationRound} · Run {run.snapshot.id}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {acceptable && (
              <Button disabled={!connected || accepting} onClick={onAccept}>
                {accepting ? "Recording acceptance…" : "Accept evidence"}
              </Button>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <span className={`run-status run-status-${run.status}`}>
            {runStatusLabel(run, connectionStep)}
          </span>
          <span>{active} active steps</span>
          <span>
            {complete} of {run.steps.length} complete
          </span>
          <span>
            Local validation:{" "}
            <strong>{summary?.validation === "passed" ? "Passed" : "Incomplete"}</strong>
            {" · "}Human acceptance: <strong>{summary?.acceptance ?? "Pending"}</strong>
          </span>
          {workspace?.branch && (
            <span className="font-mono text-muted-foreground">{workspace.branch}</span>
          )}
          <span
            className={connected && streamConnected !== false ? "text-emerald-700" : "text-red-700"}
          >
            {!connected
              ? "Disconnected · work state unknown"
              : streamConnected === false
                ? "Event stream reconnecting · runtime reachable"
                : streamConnected === true
                  ? "Live event stream"
                  : "Runtime reachable · polling"}
          </span>
        </div>
      </header>
      {/* Kept mounted so the message is announced once when the banner appears, without
          turning the banner's buttons into alert content. */}
      <output aria-live="polite" className="sr-only">
        {connectionStep
          ? `Issue ${run.snapshot.task.ticketId ?? ""} could not be retrieved. Connect your issue tracker to continue.`
          : ""}
      </output>
      {connectionStep && (
        <section
          aria-labelledby={connectionHeadingId}
          className="rounded-lg border border-amber-300 bg-amber-50 p-5"
        >
          <h3 id={connectionHeadingId} className="font-semibold">
            Connect your issue tracker to continue
          </h3>
          <p className="mt-1 text-sm">
            {run.snapshot.task.ticketId} could not be read. Connect its issue tracker MCP (for
            example Jira or Linear) in your {connectionAgentName ?? "selected AI tool"} settings,
            then retry this step. Your run and workspace are saved.
          </p>
          {!connectionRetryAvailable && (
            <p className="mt-2 text-sm">
              This step has reached its retry limit. Start a new run after connecting your issue
              tracker.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={
                !connected ||
                executing ||
                !onRetry ||
                !connectionAttempt ||
                !connectionRetryAvailable
              }
              onClick={() => {
                if (connectionAttempt) onRetry?.(connectionStep.stepId, connectionAttempt.id);
              }}
            >
              Retry after connecting
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                open({
                  kind: "step",
                  stepId: connectionStep.stepId,
                  attemptId: connectionAttempt?.id ?? null,
                })
              }
            >
              Inspect attempt
            </Button>
          </div>
        </section>
      )}
      {stopCause && (
        <RunStopBanner
          run={run}
          cause={stopCause}
          connected={connected}
          executing={executing}
          onRetry={
            onRetry &&
            ((stepId, attemptId) => {
              // The banner unmounts once the run resumes; keep focus on the run title instead.
              titleRef.current?.focus();
              onRetry(stepId, attemptId, titleRef.current);
            })
          }
          onInspect={(stepId) => {
            const step = run.steps.find((item) => item.stepId === stepId);
            open({ kind: "step", stepId, attemptId: step?.attempts.at(-1)?.id ?? null });
          }}
        />
      )}
      <RunInputPrompt run={run} agents={agents} connected={connected} onReply={onReplyToInput} />
      <RunGraph
        overlay={runControls}
        run={run}
        selectedStepId={scope?.kind === "step" ? scope.stepId : null}
        onSelect={(stepId) => {
          const step = run.steps.find((item) => item.stepId === stepId);
          open({ kind: "step", stepId, attemptId: step?.attempts.at(-1)?.id ?? null });
        }}
      />
      <div className="flex items-center justify-between rounded-lg border bg-white p-3 text-xs">
        <span>{connected ? "Receiving run updates" : "Reconnecting to runtime…"}</span>
        <Button variant="ghost" size="sm" onClick={() => open({ kind: "run" })}>
          Inspect run evidence
        </Button>
      </div>
      <Dialog open={panel === "description"} onOpenChange={(next) => !next && setPanel(null)}>
        <DialogContent onCloseAutoFocus={returnFocus("description")}>
          <DialogTitle className="text-xl font-semibold">Description</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {run.snapshot.task.ticket
              ? `${run.snapshot.task.ticket.id} · ${run.snapshot.task.ticket.title}`
              : run.snapshot.task.ticketId
                ? `Ticket ${run.snapshot.task.ticketId}, read by the agent through its tracker MCP`
                : "Description-only run"}
          </DialogDescription>
          {run.snapshot.task.ticket?.summary && (
            <p className="mt-4 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
              {run.snapshot.task.ticket.summary}
            </p>
          )}
          {run.snapshot.task.description && (
            <p className="mt-4 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
              {run.snapshot.task.description}
            </p>
          )}
        </DialogContent>
      </Dialog>
      {workspace && (
        <Dialog open={panel === "branch"} onOpenChange={(next) => !next && setPanel(null)}>
          <DialogContent className="w-[min(95vw,820px)]" onCloseAutoFocus={returnFocus("branch")}>
            <DialogTitle className="sr-only">Run branch</DialogTitle>
            <DialogDescription className="sr-only">
              Branch, project checkout, commits and branch actions for this run.
            </DialogDescription>
            <RunWorkspacePanel
              bare
              workspace={workspace}
              summary={summary}
              connected={connected}
              busy={executing}
              onPromote={onPromote}
              onRemove={onRemoveWorktree}
              onReturn={onReturnCheckout}
            />
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={panel === "evidence"} onOpenChange={(next) => !next && setPanel(null)}>
        <DialogContent className="w-[min(95vw,960px)]" onCloseAutoFocus={returnFocus("evidence")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-xl font-semibold">Final evidence summary</DialogTitle>
              <DialogDescription className="mt-1 text-sm">
                Local validation:{" "}
                <strong>{summary?.validation === "passed" ? "Passed" : "Incomplete"}</strong>
                {" · "}Human acceptance: <strong>{summary?.acceptance ?? "Pending"}</strong>
              </DialogDescription>
            </div>
            {acceptable && (
              <Button disabled={!connected || accepting} onClick={onAccept}>
                {accepting ? "Recording acceptance…" : "Accept evidence"}
              </Button>
            )}
          </div>
          <div className="mt-5">
            <RunEvidenceSummary
              summary={summary}
              complete={complete}
              total={run.steps.length}
              onOpenFiles={() => openFromEvidence("Files")}
              onOpenArtifacts={() => openFromEvidence("Artifacts")}
            />
          </div>
        </DialogContent>
      </Dialog>
      {scope && (
        <RunInspector
          run={run}
          summary={summary}
          scope={scope}
          onScopeChange={setScope}
          onClose={close}
          connected={connected}
          agents={agents}
          onSendGuidance={onSendGuidance}
          initialTab={initialTab}
          onRetry={onRetry}
          executing={executing}
        />
      )}
    </div>
  );
};
