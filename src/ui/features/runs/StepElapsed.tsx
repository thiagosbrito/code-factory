import { formatDuration, hasRunningAttempt, stepElapsedMs } from "./step-timing";
import type { RunStep } from "./run-view-model";
import { useNow } from "./useNow";

/**
 * A step's time spent running. It owns its own clock, so one running step re-renders only this
 * label each second, not the whole graph; nothing renders while the time is unknown.
 */
export const StepElapsed = ({ step }: { step: RunStep | undefined }) => {
  const now = useNow(step ? hasRunningAttempt([step]) : false);
  const elapsed = stepElapsedMs(step, now);
  return elapsed === null ? null : (
    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
      {formatDuration(elapsed)}
    </span>
  );
};
