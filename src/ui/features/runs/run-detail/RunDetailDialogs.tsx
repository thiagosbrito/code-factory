import type { EvidenceSummary } from "../../../../domain/acceptance.js";
import type { RunWorkspace } from "../../../../domain/run-branch.js";
import type { RunRecord } from "../../../../domain/run.js";
import type { PromoteFailure } from "../PromoteRunDialog";
import { stepProgress } from "../run-view-model";
import { RunBranchDialog } from "./RunBranchDialog";
import { RunDescriptionDialog } from "./RunDescriptionDialog";
import { RunEvidenceDialog } from "./RunEvidenceDialog";
import type { RunDetailPanels } from "./useRunDetailPanels";

/** The description, run branch and final evidence dialogs; at most one is open. */
export const RunDetailDialogs = ({
  run,
  summary,
  workspace,
  panels,
  acceptable,
  accepting,
  connected,
  executing,
  onAccept,
  onPromote,
  onRemoveWorktree,
  onReturnCheckout,
}: {
  run: RunRecord;
  summary: EvidenceSummary | null;
  workspace: RunWorkspace | null;
  panels: Pick<RunDetailPanels, "panel" | "setPanel" | "returnFocus" | "openFromEvidence">;
  acceptable: boolean;
  accepting: boolean;
  connected: boolean;
  executing: boolean;
  onAccept: () => void;
  onPromote: (name: string) => Promise<PromoteFailure | { warning?: string }>;
  onRemoveWorktree: () => Promise<string | null>;
  onReturnCheckout: () => Promise<string | null>;
}) => {
  const close = () => panels.setPanel(null);
  return (
    <>
      <RunDescriptionDialog
        run={run}
        open={panels.panel === "description"}
        onClose={close}
        onCloseAutoFocus={panels.returnFocus("description")}
      />
      {workspace && (
        <RunBranchDialog
          open={panels.panel === "branch"}
          onClose={close}
          onCloseAutoFocus={panels.returnFocus("branch")}
          workspace={workspace}
          summary={summary}
          connected={connected}
          busy={executing}
          onPromote={onPromote}
          onRemove={onRemoveWorktree}
          onReturn={onReturnCheckout}
        />
      )}
      <RunEvidenceDialog
        summary={summary}
        complete={stepProgress(run).complete}
        total={run.steps.length}
        open={panels.panel === "evidence"}
        acceptable={acceptable}
        accepting={accepting}
        connected={connected}
        onAccept={onAccept}
        onClose={close}
        onCloseAutoFocus={panels.returnFocus("evidence")}
        onOpenFiles={() => panels.openFromEvidence("Files")}
        onOpenArtifacts={() => panels.openFromEvidence("Artifacts")}
      />
    </>
  );
};
