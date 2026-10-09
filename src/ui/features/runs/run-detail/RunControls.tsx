import { Button } from "@/shared/components/button";
import { PlayIcon, RetryIcon, StopIcon } from "../../../shared/icons";

/** Execute or resume, retry the stopped step, and cancel, shown only when each applies. */
export const RunControls = ({
  pending,
  resumable,
  canCancel,
  retryable,
  retryLabel,
  connected,
  executing,
  onExecute,
  onRetry,
  onCancel,
}: {
  pending: boolean;
  resumable: boolean;
  canCancel: boolean;
  retryable: boolean;
  retryLabel: string;
  connected: boolean;
  executing: boolean;
  onExecute: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) => {
  if (!(pending || resumable || canCancel || retryable)) return null;
  const executeLabel = resumable ? "Resume run" : "Execute run";
  return (
    <div className="flex items-center gap-1 border-r pr-1">
      {(pending || resumable) && (
        <Button
          size="sm"
          aria-label={executeLabel}
          title={executing ? "Executing…" : executeLabel}
          aria-busy={executing || undefined}
          className="h-9 w-9 p-0"
          disabled={executing || !connected}
          onClick={onExecute}
        >
          <PlayIcon />
        </Button>
      )}
      {retryable && (
        <Button
          size="sm"
          aria-label={retryLabel}
          title={retryLabel}
          className="h-9 w-9 p-0"
          disabled={!connected || executing}
          onClick={onRetry}
        >
          <RetryIcon />
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
  );
};
