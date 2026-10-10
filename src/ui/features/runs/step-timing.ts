import type { RunStep } from "./run-view-model";

/**
 * Time a step has spent running, summed over its attempts: an ended attempt counts its recorded
 * span, an attempt still `running` counts up to `now`. An attempt that has no end time and is not
 * running (paused, waiting for input, interrupted) has an unknown running time, so the whole
 * answer is null rather than a number that drops to zero and jumps back on resume. Also null while
 * the step has no attempt.
 */
export const stepElapsedMs = (step: RunStep | undefined, now: number): number | null => {
  if (!step?.attempts.length) return null;
  let total = 0;
  for (const attempt of step.attempts) {
    const started = Date.parse(attempt.startedAt);
    if (attempt.endedAt) total += Math.max(0, Date.parse(attempt.endedAt) - started);
    else if (attempt.status === "running") total += Math.max(0, now - started);
    else return null;
  }
  return total;
};

export const hasRunningAttempt = (steps: RunStep[]): boolean =>
  steps.some((step) => step.attempts.some((attempt) => attempt.status === "running"));

/** 42s, 3m 12s, 1h 04m: seconds shown under an hour, never milliseconds. */
export const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
};
