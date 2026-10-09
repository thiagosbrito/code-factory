import { useRef, type ReactNode, type RefObject } from "react";
import type { RunRecord } from "../../../../domain/run.js";
import { Button } from "@/shared/components/button";
import { NativeSelect } from "@/shared/components/native-select";
import { RetryStepDialog } from "../RetryStepDialog";
import {
  stepDisplayStatus,
  type RunScope,
  type RunStep,
  type StepDefinition,
} from "../run-view-model";

type RetryStep = (stepId: string, attemptId: string, focusTarget?: HTMLElement | null) => void;

/** Scope label, step title, close, attempt selector and retry, with the tabs passed as children. */
export const InspectorHeader = ({
  run,
  scope,
  step,
  definition,
  closeRef,
  retryReason,
  retryOpen,
  onRetryOpenChange,
  onRetry,
  onClose,
  onScopeChange,
  children,
}: {
  run: RunRecord;
  scope: RunScope;
  step: RunStep | undefined;
  definition: StepDefinition | undefined;
  closeRef: RefObject<HTMLButtonElement | null>;
  retryReason: string;
  retryOpen: boolean;
  onRetryOpenChange: (open: boolean) => void;
  onRetry: RetryStep | undefined;
  onClose: () => void;
  onScopeChange: (scope: RunScope) => void;
  children: ReactNode;
}) => {
  const retryTrigger = useRef<HTMLButtonElement>(null);
  const latestAttempt = step?.attempts.at(-1);
  return (
    <header className="border-b p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {scope.kind === "run"
          ? "Run scope"
          : `Step · ${scope.stepId} · ${scope.attemptId ? `Attempt ${step?.attempts.find((item) => item.id === scope.attemptId)?.number ?? "?"}` : "All attempts"}`}
      </p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{definition?.name ?? "Run evidence"}</h2>
          <p className="text-xs text-muted-foreground">
            {scope.kind === "run"
              ? run.snapshot.id
              : `${definition?.role ?? "Step"} · ${step ? stepDisplayStatus(run, step) : "unknown"}`}
          </p>
        </div>
        <Button
          ref={closeRef}
          size="sm"
          variant="outline"
          onClick={onClose}
          aria-label="Close inspector"
        >
          Close
        </Button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant={scope.kind === "run" ? "secondary" : "ghost"}
          onClick={() => onScopeChange({ kind: "run" })}
        >
          Run scope
        </Button>
        {step && (
          <NativeSelect
            className="w-auto min-w-36"
            aria-label="Selected attempt"
            value={scope.kind === "step" ? (scope.attemptId ?? "") : ""}
            onChange={(event) =>
              onScopeChange({
                kind: "step",
                stepId: step.stepId,
                attemptId: event.target.value || null,
              })
            }
          >
            <option value="">All attempts</option>
            {step.attempts.map((item) => (
              <option key={item.id} value={item.id}>
                Attempt {item.number} · {item.status}
              </option>
            ))}
          </NativeSelect>
        )}
        {step && onRetry && (
          <Button
            ref={retryTrigger}
            size="sm"
            variant="outline"
            disabled={Boolean(retryReason)}
            title={retryReason || undefined}
            onClick={() => onRetryOpenChange(true)}
          >
            Retry…
          </Button>
        )}
      </div>
      {step && latestAttempt && onRetry && (
        <RetryStepDialog
          run={run}
          stepId={step.stepId}
          open={retryOpen}
          onOpenChange={onRetryOpenChange}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            retryTrigger.current?.focus();
          }}
          onConfirm={() => {
            onRetryOpenChange(false);
            // The dialog's own button is focused here, so pass the inspector trigger explicitly.
            onRetry(step.stepId, latestAttempt.id, retryTrigger.current);
          }}
        />
      )}
      {children}
    </header>
  );
};
