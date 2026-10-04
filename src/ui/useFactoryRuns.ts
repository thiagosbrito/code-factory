import { useEffect, useState } from "react";
import type { LoopDefinition } from "../domain/loop.js";
import type { RunRecord } from "../domain/run.js";
import {
  api,
  ApiError,
  publishedLoopsResponseSchema,
  runsResponseSchema,
  trackerStatusResponseSchema,
  runResponseSchema,
  executionEventSchema,
} from "./project-api";
import { mergeRunEvent, mergeRunSnapshot } from "./run-events";

/** Runtime data and run navigation owned by the factory screen. */
export const useFactoryRuns = (demo: boolean) => {
  const [notice, setNotice] = useState("");
  const [publishedLoops, setPublishedLoops] = useState<LoopDefinition[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [trackerConfigured, setTrackerConfigured] = useState(false);
  const [executingRunId, setExecutingRunId] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState(
    () => location.hash.match(/^#runs\/([0-9a-f-]{36})$/i)?.[1] ?? "",
  );
  const selectedRun = runs.find((run) => run.snapshot.id === selectedRunId);
  const pollingRunId = selectedRunId || executingRunId;
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
  useEffect(() => {
    if (!pollingRunId || demo) return;
    const timer = window.setInterval(() => {
      void api(`/api/runs/${pollingRunId}`, runResponseSchema.parse)
        .then(({ run }) =>
          setRuns((previous) =>
            previous.map((item) =>
              item.snapshot.id === pollingRunId ? mergeRunSnapshot(item, run) : item,
            ),
          ),
        )
        .then(() => setConnected(true))
        .catch(() => setConnected(false));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [demo, pollingRunId]);
  useEffect(() => {
    if (demo || !selectedRunId || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/runs/${selectedRunId}/events`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("execution-event", (message) => {
      try {
        const event = executionEventSchema.parse(JSON.parse((message as MessageEvent).data));
        setRuns((previous) =>
          previous.map((item) =>
            item.snapshot.id === selectedRunId ? mergeRunEvent(item, event) : item,
          ),
        );
      } catch {
        setConnected(false);
      }
    });
    source.addEventListener("run-state", (message) => {
      try {
        const run = runResponseSchema.shape.run.parse(JSON.parse((message as MessageEvent).data));
        setRuns((previous) =>
          previous.map((item) =>
            item.snapshot.id === selectedRunId ? mergeRunSnapshot(item, run) : item,
          ),
        );
      } catch {
        setConnected(false);
      }
    });
    return () => source.close();
  }, [demo, selectedRunId]);
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
  const execute = async (id: string) => {
    setExecutingRunId(id);
    setNotice("");
    try {
      const { run } = await api(`/api/runs/${id}/execute`, runResponseSchema.parse, {
        method: "POST",
      });
      setRuns((previous) =>
        previous.map((item) => (item.snapshot.id === id ? mergeRunSnapshot(item, run) : item)),
      );
    } catch (error) {
      if (error instanceof ApiError) setNotice(error.message);
      else {
        setConnected(false);
        setNotice("Connection lost. Execution state is unknown; reconnect to inspect this run.");
      }
    } finally {
      setExecutingRunId(null);
    }
  };
  const cancel = async (id: string) => {
    try {
      const { run } = await api(`/api/runs/${id}/cancel`, runResponseSchema.parse, {
        method: "POST",
      });
      setRuns((previous) => previous.map((item) => (item.snapshot.id === id ? run : item)));
    } catch (error) {
      if (error instanceof ApiError) setNotice(error.message);
      else {
        setConnected(false);
        setNotice("Connection lost. Cancellation state is unknown; reconnect to inspect this run.");
      }
    }
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
    execute,
    cancel,
    executingRunId,
    connected,
  };
};
