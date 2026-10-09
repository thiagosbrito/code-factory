import { useState } from "react";
import type { RunRecord } from "../../../domain/run.js";
import { api, runResponseSchema, type ProjectPatch } from "../../shared/project-api";
import { useRunBranchActions } from "./hooks/useRunBranchActions";
import { useRunCommands } from "./hooks/useRunCommands";
import { useRunEventStream } from "./hooks/useRunEventStream";
import { useRunEvidenceAndWorkspace } from "./hooks/useRunEvidenceAndWorkspace";
import { useRunHistory } from "./hooks/useRunHistory";
import { useRunPermissions } from "./hooks/useRunPermissions";
import { useRunPolling } from "./hooks/useRunPolling";
import { useSelectedRunRoute } from "./hooks/useSelectedRunRoute";

/** Runtime data and run navigation owned by the factory screen. */
export const useFactoryRuns = (
  demo: boolean,
  options: { onProjectChanged?: (next: ProjectPatch) => void } = {},
) => {
  const [notice, setNotice] = useState("");
  const { selectedRunId, setSelectedRunId, openRun } = useSelectedRunRoute();
  const history = useRunHistory(demo, selectedRunId);
  const { runs, setRuns, setConnected } = history;
  const feedback = { setConnected, setNotice };
  const { evidenceSummary, workspace, setEvidence, refreshWorkspace } = useRunEvidenceAndWorkspace(
    demo,
    selectedRunId,
  );
  const permissions = useRunPermissions(runs, feedback, options.onProjectChanged);
  const commands = useRunCommands({
    ensurePermissions: permissions.ensurePermissions,
    setRuns,
    setEvidence,
    feedback,
  });
  const branchActions = useRunBranchActions(setRuns, refreshWorkspace);
  const interrupted = useRunPolling(
    demo,
    selectedRunId || commands.executingRunId,
    setRuns,
    setConnected,
  );
  const streamConnected = useRunEventStream(demo, selectedRunId, setRuns);

  const onStarted = (id: string, run?: RunRecord) => {
    openRun(id);
    const adopt = (started: RunRecord) =>
      setRuns((previous) => [started, ...previous.filter((item) => item.snapshot.id !== id)]);
    if (run) {
      adopt(run);
      return;
    }
    void api(`/api/runs/${id}`, runResponseSchema.parse)
      .then(({ run: started }) => adopt(started))
      .catch((error: unknown) =>
        setNotice(error instanceof Error ? error.message : "Could not load run."),
      );
  };

  return {
    notice,
    setNotice,
    publishedLoops: history.publishedLoops,
    setPublishedLoops: history.setPublishedLoops,
    runs,
    trackerConfigured: history.trackerConfigured,
    selectedRun: runs.find((run) => run.snapshot.id === selectedRunId),
    setSelectedRunId,
    openRun,
    onStarted,
    execute: commands.execute,
    cancel: commands.cancel,
    retry: commands.retry,
    sendGuidance: commands.sendGuidance,
    replyToInput: commands.replyToInput,
    accept: commands.accept,
    accepting: commands.accepting,
    evidenceSummary,
    workspace,
    promote: branchActions.promote,
    removeWorktree: branchActions.removeWorktree,
    returnCheckout: branchActions.returnCheckout,
    toolGrantPrompt: permissions.toolGrantPrompt,
    answerToolGrant: permissions.answerToolGrant,
    trustPrompt: permissions.trustPrompt,
    answerTrust: permissions.answerTrust,
    selectedRunInterrupted: interrupted?.runId === selectedRunId && interrupted.value,
    toolGrantReturnFocus: permissions.toolGrantReturnFocus,
    executingRunId: commands.executingRunId,
    connected: history.connected,
    streamConnected,
    historyState: history.historyState,
    historyError: history.historyError,
    reload: history.reload,
    selectedRunId,
  };
};
