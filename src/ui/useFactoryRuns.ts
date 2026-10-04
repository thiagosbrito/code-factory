import { useEffect, useState } from "react";
import type { LoopDefinition } from "../domain/loop.js";
import type { RunRecord } from "../domain/run.js";
import {
  api,
  publishedLoopsResponseSchema,
  runsResponseSchema,
  trackerStatusResponseSchema,
  runResponseSchema,
} from "./project-api";

/** Runtime data and run navigation owned by the factory screen. */
export const useFactoryRuns = (demo: boolean) => {
  const [notice, setNotice] = useState("");
  const [publishedLoops, setPublishedLoops] = useState<LoopDefinition[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [trackerConfigured, setTrackerConfigured] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState(
    () => location.hash.match(/^#runs\/([0-9a-f-]{36})$/i)?.[1] ?? "",
  );
  const selectedRun = runs.find((run) => run.snapshot.id === selectedRunId);
  useEffect(() => {
    if (demo) return;
    void Promise.all([
      api("/api/loops/published", publishedLoopsResponseSchema.parse),
      api("/api/runs", runsResponseSchema.parse),
      api("/api/tracker", trackerStatusResponseSchema.parse),
    ])
      .then(([loops, history, tracker]) => {
        setPublishedLoops(loops.loops);
        setRuns(history.runs);
        setTrackerConfigured(tracker.configured);
      })
      .catch((error: unknown) =>
        setNotice(error instanceof Error ? error.message : "Could not load run history."),
      );
  }, [demo]);
  const openRun = (id: string) => {
    setSelectedRunId(id);
    window.history.pushState(null, "", `#runs/${id}`);
  };
  const onStarted = (id: string, run?: RunRecord) => {
    openRun(id);
    if (run) {
      setRuns((previous) => [run, ...previous.filter((item) => item.snapshot.id !== id)]);
      return;
    }
    void api(`/api/runs/${id}`, runResponseSchema.parse)
      .then(({ run }) =>
        setRuns((previous) => [run, ...previous.filter((item) => item.snapshot.id !== id)]),
      )
      .catch((error: unknown) =>
        setNotice(error instanceof Error ? error.message : "Could not load run."),
      );
  };
  return {
    notice,
    setNotice,
    publishedLoops,
    setPublishedLoops,
    runs,
    trackerConfigured,
    selectedRun,
    setSelectedRunId,
    openRun,
    onStarted,
  };
};
