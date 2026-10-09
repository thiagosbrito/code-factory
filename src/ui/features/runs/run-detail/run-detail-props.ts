import type { AgentConnection } from "../../../../adapters/contract.js";
import type { EvidenceSummary } from "../../../../domain/acceptance.js";
import type { RunWorkspace } from "../../../../domain/run-branch.js";
import type { RunRecord } from "../../../../domain/run.js";
import type { PromoteFailure } from "../PromoteRunDialog";

export type RunDetailProps = {
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
  /** Unfinished, but the runtime is not executing it (for example after a restart). */
  interrupted?: boolean;
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
};
