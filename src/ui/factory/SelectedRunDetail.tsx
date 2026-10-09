import type { AgentConnection } from "../../adapters/contract.js";
import type { RunRecord } from "../../domain/run.js";
import { RunDetail } from "../features/runs/RunDetail";
import type { FactoryRuns } from "../features/runs/useFactoryRuns";

/** Binds the selected run's detail view to the run commands. */
export const SelectedRunDetail = ({
  run,
  factory,
  agents,
  onBack,
}: {
  run: RunRecord;
  factory: FactoryRuns;
  agents: AgentConnection[];
  onBack: () => void;
}) => {
  const id = run.snapshot.id;
  return (
    <RunDetail
      key={id}
      run={run}
      summary={factory.evidenceSummary}
      accepting={factory.accepting}
      onAccept={() => void factory.accept(id)}
      connected={factory.connected}
      streamConnected={factory.streamConnected}
      executing={factory.executingRunId === id}
      interrupted={factory.selectedRunInterrupted}
      onExecute={() => void factory.execute(id)}
      onCancel={() => void factory.cancel(id)}
      agents={agents}
      onRetry={(stepId, attemptId, focusTarget) =>
        void factory.retry(id, stepId, attemptId, focusTarget ?? undefined)
      }
      workspace={factory.workspace}
      onPromote={(name) => factory.promote(id, name)}
      onRemoveWorktree={() => factory.removeWorktree(id)}
      onReturnCheckout={() => factory.returnCheckout(id)}
      onSendGuidance={(input) => factory.sendGuidance(id, input)}
      onReplyToInput={(input) => factory.replyToInput(id, input)}
      onBack={onBack}
    />
  );
};
