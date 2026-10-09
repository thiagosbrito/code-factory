import { RunGraph } from "./RunGraph";
import { RunInspector } from "./RunInspector";
import { RunInputPrompt } from "./RunInputPrompt";
import { RunStopBanner } from "./RunStopBanner";
import type { RunDetailProps } from "./run-detail/run-detail-props";
import { RunControls } from "./run-detail/RunControls";
import { RunDetailHeader } from "./run-detail/RunDetailHeader";
import { RunDetailDialogs } from "./run-detail/RunDetailDialogs";
import { RunDetailNav } from "./run-detail/RunDetailNav";
import { RunUpdatesBar } from "./run-detail/RunUpdatesBar";
import { TrackerConnectionNotice } from "./run-detail/TrackerConnectionNotice";
import { useRunDetailPanels } from "./run-detail/useRunDetailPanels";
import { useStoppedRetry } from "./run-detail/useStoppedRetry";
import { runStopCause, trackerConnectionStep } from "./run-view-model";

export const RunDetail = ({
  run,
  summary,
  accepting,
  onAccept,
  connected,
  streamConnected,
  executing,
  interrupted = false,
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
}: RunDetailProps) => {
  const panels = useRunDetailPanels(run);
  const acceptable = summary?.validation === "passed" && summary.acceptance !== "accepted";
  // Computed once per render and shared by the status label and the banner.
  const connectionStep = trackerConnectionStep(run);
  // At most one banner: the tracker-connection banner already explains a failed issue lookup.
  const stopCause = connectionStep ? undefined : runStopCause(run);
  const stopped = useStoppedRetry(run, stopCause, onRetry);
  const canCancel =
    connected &&
    (executing || ["pending", "running", "waiting-input", "paused"].includes(run.status));
  // Nothing resumes on its own after a restart; the user resumes an interrupted run explicitly.
  const resumable = interrupted && ["running", "waiting-input", "paused"].includes(run.status);
  return (
    <div className="mt-7 space-y-5">
      <RunDetailHeader
        run={run}
        summary={summary}
        branch={workspace?.branch}
        connectionStep={connectionStep}
        acceptable={acceptable}
        accepting={accepting}
        connected={connected}
        streamConnected={streamConnected}
        titleRef={stopped.titleRef}
        onAccept={onAccept}
        onBack={onBack}
      />
      <TrackerConnectionNotice
        run={run}
        step={connectionStep}
        connected={connected}
        executing={executing}
        onRetry={onRetry}
        onInspect={panels.open}
      />
      {stopCause && (
        <RunStopBanner
          run={run}
          cause={stopCause}
          connected={connected}
          executing={executing}
          onRetry={onRetry && stopped.retryAt}
          onInspect={panels.openStep}
        />
      )}
      <RunInputPrompt run={run} agents={agents} connected={connected} onReply={onReplyToInput} />
      <RunGraph
        overlay={
          <div className="flex items-center gap-1">
            <RunControls
              pending={run.status === "pending"}
              resumable={resumable}
              canCancel={canCancel}
              retryable={stopped.retryable}
              retryLabel={stopped.label}
              connected={connected}
              executing={executing}
              onExecute={onExecute}
              onRetry={stopped.retry}
              onCancel={onCancel}
            />
            <RunDetailNav
              hasWorkspace={Boolean(workspace)}
              acceptable={acceptable}
              accepted={summary?.acceptance === "accepted"}
              triggers={panels.panelTriggers}
              onOpen={panels.setPanel}
            />
          </div>
        }
        retry={
          stopped.retryable && stopped.stepId
            ? {
                stepId: stopped.stepId,
                label: stopped.label,
                disabled: !connected || executing,
                onRetry: stopped.retry,
              }
            : null
        }
        run={run}
        selectedStepId={panels.scope?.kind === "step" ? panels.scope.stepId : null}
        onSelect={panels.openStep}
      />
      <RunUpdatesBar connected={connected} onInspect={() => panels.open({ kind: "run" })} />
      <RunDetailDialogs
        run={run}
        summary={summary}
        workspace={workspace}
        panels={panels}
        acceptable={acceptable}
        accepting={accepting}
        connected={connected}
        executing={executing}
        onAccept={onAccept}
        onPromote={onPromote}
        onRemoveWorktree={onRemoveWorktree}
        onReturnCheckout={onReturnCheckout}
      />
      {panels.scope && (
        <RunInspector
          run={run}
          summary={summary}
          scope={panels.scope}
          onScopeChange={panels.setScope}
          onClose={panels.close}
          connected={connected}
          agents={agents}
          onSendGuidance={onSendGuidance}
          initialTab={panels.initialTab}
          onRetry={onRetry}
          executing={executing}
        />
      )}
    </div>
  );
};
