import { useEffect, useState } from "react";
import { api, runResponseSchema } from "../../../shared/project-api";
import { mergeRunSnapshot } from "../run-events";
import type { SetRuns } from "./run-updates";

/** Polls one run once a second and reports whether the runtime says it is interrupted. */
export const useRunPolling = (
  demo: boolean,
  pollingRunId: string | null,
  setRuns: SetRuns,
  setConnected: (connected: boolean) => void,
) => {
  // The runtime's own answer: unfinished, but not being executed (for example after a restart).
  const [interrupted, setInterrupted] = useState<{ runId: string; value: boolean } | null>(null);
  useEffect(() => {
    if (!pollingRunId || demo) return;
    const refresh = () => {
      void api(`/api/runs/${pollingRunId}`, runResponseSchema.parse)
        .then(({ run, interrupted: stopped }) => {
          setInterrupted({ runId: pollingRunId, value: Boolean(stopped) });
          setRuns((previous) => {
            const existing = previous.find((item) => item.snapshot.id === pollingRunId);
            return existing
              ? previous.map((item) =>
                  item.snapshot.id === pollingRunId ? mergeRunSnapshot(item, run) : item,
                )
              : [run, ...previous];
          });
        })
        .then(() => setConnected(true))
        .catch(() => setConnected(false));
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [demo, pollingRunId, setRuns, setConnected]);
  return interrupted;
};
