import { type RunRecord } from "./run-record.js";

/** Attempts are budgeted per implementation round, so a repair round restores retries. */
export const hasRetryBudget = (record: RunRecord, step: RunRecord["steps"][number]): boolean =>
  step.attempts.filter((attempt) => attempt.implementationRound === record.implementationRound)
    .length < record.snapshot.loop.policy.maxAttemptsPerStep;

/** A review step holding a `blocked` verdict (persisted as succeeded with outcome blocked). */
export const isHeldReviewBlock = (record: RunRecord, step: RunRecord["steps"][number]): boolean =>
  step.status === "succeeded" &&
  step.outcome === "blocked" &&
  record.snapshot.loop.steps.find((item) => item.id === step.stepId)?.stage === "review";

/**
 * Single retry eligibility rule for domain, server and UI: a failed step of a failed run, or a
 * review step holding a `blocked` verdict while the run is blocked. Returns why not, or null.
 */
export const RETRY_NOT_ELIGIBLE = "Only a failed step in a failed run can be retried.";

export const RETRY_LIMIT_REACHED = "Attempt limit reached for this step.";

export const retryBlocker = (record: RunRecord, stepId: string): string | null => {
  const step = record.steps.find((item) => item.stepId === stepId);
  if (!step || !record.snapshot.loop.steps.some((item) => item.id === stepId))
    return "Unknown retry target.";
  const eligible =
    (record.status === "failed" && step.status === "failed") ||
    (record.status === "blocked" && isHeldReviewBlock(record, step));
  if (!eligible) return RETRY_NOT_ELIGIBLE;
  if (record.steps.some((item) => ["running", "waiting-input", "paused"].includes(item.status)))
    return "Active work must finish before retry.";
  if (!hasRetryBudget(record, step)) return RETRY_LIMIT_REACHED;
  return null;
};
