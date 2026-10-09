import { useId } from "react";
import { retryBlocker, type RunRecord } from "../../../domain/run.js";
import { Button } from "@/shared/components/button";
import { Markdown } from "../../shared/Markdown";
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
      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
    >
      {/* Compact so the canvas stays in view; the full detail is one click away in the step. */}
      <div className="min-w-0 flex-1">
        <h3 id={headingId} className="font-semibold">
          {heading(cause)}
        </h3>
        {cause.summary && <Markdown className="mt-1 line-clamp-3">{cause.summary}</Markdown>}
        {cause.kind === "setup" && (
          <p className="mt-1 text-sm">Fix the setup command in Setup, then start a new run.</p>
        )}
      </div>
      {stepId && (
        <div className="flex flex-wrap gap-2">
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
