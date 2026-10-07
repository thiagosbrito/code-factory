import { useId } from "react";
import { retryBlocker, type RunRecord } from "../domain/run.js";
import { Button } from "@/components/ui/button";
import type { RunStopCause } from "./run-view-model";

const heading = (cause: RunStopCause): string =>
  cause.kind === "review-blocked"
    ? `${cause.name} blocked the run`
    : cause.kind === "setup"
      ? "The setup command stopped the run"
      : cause.kind === "canceled"
        ? "The run was canceled"
        : `${cause.name} failed`;

/** Names the step (or setup) that stopped the run, with its summary and recovery actions. */
export const RunStopBanner = ({
  run,
  cause,
  connected,
  executing,
  onInspect,
  onRetry,
}: {
  run: RunRecord;
  cause: RunStopCause;
  connected: boolean;
  executing: boolean;
  onInspect: (stepId: string) => void;
  onRetry?: ((stepId: string, attemptId: string) => void) | undefined;
}) => {
  const headingId = useId();
  const stepId = cause.stepId;
  const attempt = stepId
    ? run.steps.find((item) => item.stepId === stepId)?.attempts.at(-1)
    : undefined;
  const retryable = Boolean(stepId && attempt && onRetry && !retryBlocker(run, stepId));
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-amber-300 bg-amber-50 p-5"
    >
      <h3 id={headingId} className="font-semibold">
        {heading(cause)}
      </h3>
      {cause.summary && <p className="mt-1 whitespace-pre-wrap text-sm">{cause.summary}</p>}
      {cause.kind === "setup" && (
        <p className="mt-2 text-sm">Fix the setup command in Setup, then start a new run.</p>
      )}
      {stepId && (
        <div className="mt-3 flex flex-wrap gap-2">
          {retryable && (
            <Button
              disabled={!connected || executing}
              onClick={() => {
                if (attempt) onRetry?.(stepId, attempt.id);
              }}
            >
              Retry {cause.name}
            </Button>
          )}
          <Button variant="outline" onClick={() => onInspect(stepId)}>
            Inspect step
          </Button>
        </div>
      )}
    </section>
  );
};
