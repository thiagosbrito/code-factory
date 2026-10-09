import { useId } from "react";
import { hasRetryBudget, type RunRecord } from "../../../../domain/run.js";
import { Button } from "@/shared/components/button";
import { providerName } from "../../../shared/connection";
import type { RunScope, RunStep } from "../run-view-model";

/** Announces and explains a failed issue lookup, with retry and inspect actions. */
export const TrackerConnectionNotice = ({
  run,
  step,
  connected,
  executing,
  onRetry,
  onInspect,
}: {
  run: RunRecord;
  /** The step whose tracker lookup failed; nothing is shown beyond the live region without it. */
  step: RunStep | undefined;
  connected: boolean;
  executing: boolean;
  onRetry?: ((stepId: string, attemptId: string) => void) | undefined;
  onInspect: (scope: RunScope) => void;
}) => {
  const headingId = useId();
  const provider = step ? run.snapshot.bindings[step.stepId]?.provider : undefined;
  const agentName = provider ? providerName(provider) : undefined;
  const attempt = step?.attempts.at(-1);
  const retryAvailable = step ? hasRetryBudget(run, step) : false;
  return (
    <>
      {/* Kept mounted so the message is announced once when the banner appears, without
          turning the banner's buttons into alert content. */}
      <output aria-live="polite" className="sr-only">
        {step
          ? `Issue ${run.snapshot.task.ticketId ?? ""} could not be retrieved. Connect your issue tracker to continue.`
          : ""}
      </output>
      {step && (
        <section
          aria-labelledby={headingId}
          className="rounded-lg border border-amber-300 bg-amber-50 p-5"
        >
          <h3 id={headingId} className="font-semibold">
            Connect your issue tracker to continue
          </h3>
          <p className="mt-1 text-sm">
            {run.snapshot.task.ticketId} could not be read. Connect its issue tracker MCP (for
            example Jira or Linear) in your {agentName ?? "selected AI tool"} settings, then retry
            this step. Your run and workspace are saved.
          </p>
          {!retryAvailable && (
            <p className="mt-2 text-sm">
              This step has reached its retry limit. Start a new run after connecting your issue
              tracker.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={!connected || executing || !onRetry || !attempt || !retryAvailable}
              onClick={() => {
                if (attempt) onRetry?.(step.stepId, attempt.id);
              }}
            >
              Retry after connecting
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                onInspect({ kind: "step", stepId: step.stepId, attemptId: attempt?.id ?? null })
              }
            >
              Inspect attempt
            </Button>
          </div>
        </section>
      )}
    </>
  );
};
