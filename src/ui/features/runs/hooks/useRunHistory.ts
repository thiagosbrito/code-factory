import { useEffect, useState } from "react";
import type { LoopDefinition } from "../../../../domain/loop.js";
import type { RunRecord } from "../../../../domain/run.js";
import {
  api,
  publishedLoopsResponseSchema,
  runsResponseSchema,
  trackerStatusResponseSchema,
} from "../../../shared/project-api";
import { mergeRunSnapshot } from "../run-events";

const historyErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Could not load run history.";

/** The run list, published loops and tracker status, refreshed while no run is open. */
export const useRunHistory = (demo: boolean, selectedRunId: string) => {
  const [publishedLoops, setPublishedLoops] = useState<LoopDefinition[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [trackerConfigured, setTrackerConfigured] = useState(false);
  const [connected, setConnected] = useState(true);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "error">("loading");
  const [historyError, setHistoryError] = useState("");
  useEffect(() => {
    if (demo) return;
    void Promise.all([
      api("/api/loops/published", publishedLoopsResponseSchema.parse).catch(() => ({ loops: [] })),
      api("/api/runs", runsResponseSchema.parse),
      api("/api/tracker", trackerStatusResponseSchema.parse).catch(() => ({ configured: false })),
    ])
      .then(([loops, history, tracker]) => {
        setPublishedLoops(loops.loops);
        setRuns(history.runs);
        setTrackerConfigured(tracker.configured);
        setHistoryState("ready");
        setHistoryError("");
        setConnected(true);
      })
      .catch((error: unknown) => {
        setHistoryState("error");
        setHistoryError(historyErrorMessage(error));
        setConnected(false);
      });
  }, [demo]);
  useEffect(() => {
    if (demo || selectedRunId || historyState !== "ready") return;
    const timer = window.setInterval(() => {
      void api("/api/runs", runsResponseSchema.parse)
        .then(({ runs: history }) => {
          setRuns((previous) =>
            history.map((run) => {
              const existing = previous.find((item) => item.snapshot.id === run.snapshot.id);
              return existing ? mergeRunSnapshot(existing, run) : run;
            }),
          );
          setConnected(true);
        })
        .catch(() => setConnected(false));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [demo, selectedRunId, historyState]);
  const reload = () => {
    setHistoryState("loading");
    void api("/api/runs", runsResponseSchema.parse)
      .then(({ runs: history }) => {
        setRuns(history);
        setHistoryState("ready");
        setHistoryError("");
        setConnected(true);
      })
      .catch((error: unknown) => {
        setHistoryState("error");
        setHistoryError(historyErrorMessage(error));
        setConnected(false);
      });
  };
  return {
    publishedLoops,
    setPublishedLoops,
    runs,
    setRuns,
    trackerConfigured,
    connected,
    setConnected,
    historyState,
    historyError,
    reload,
  };
};
