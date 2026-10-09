import { useRef } from "react";
import { retryBlocker, type RunRecord } from "../../../../domain/run.js";
import type { RunStopCause } from "../run-view-model";

type RetryStep = (stepId: string, attemptId: string, focusTarget?: HTMLElement | null) => void;

/** Retrying the stopped step from its node, the floating bar and the stop banner. */
export const useStoppedRetry = (
  run: RunRecord,
  stopCause: RunStopCause | undefined,
  onRetry: RetryStep | undefined,
) => {
  const titleRef = useRef<HTMLHeadingElement>(null);
  // The stopped step that can be retried now, offered on its node and in the floating bar.
  const stepId = stopCause?.stepId;
  const attempt = stepId
    ? run.steps.find((item) => item.stepId === stepId)?.attempts.at(-1)
    : undefined;
  const retryable = Boolean(stepId && attempt && onRetry && !retryBlocker(run, stepId));
  const label = `Retry ${stopCause?.name ?? stepId ?? ""}`;
  const retryAt = (retryStepId: string, attemptId: string) => {
    // The banner, button and node state change once the run resumes; keep focus on the title.
    titleRef.current?.focus();
    onRetry?.(retryStepId, attemptId, titleRef.current);
  };
  const retry = () => {
    if (stepId && attempt) retryAt(stepId, attempt.id);
  };
  return { titleRef, stepId, retryable, label, retry, retryAt };
};
