import { useEffect, useState } from "react";
import { executionEventSchema, runResponseSchema } from "../../../shared/project-api";
import { mergeRunEvent, mergeRunSnapshot } from "../run-events";
import type { SetRuns } from "./run-updates";

/** Applies the selected run's server-sent events and tracks whether the stream is connected. */
export const useRunEventStream = (demo: boolean, selectedRunId: string, setRuns: SetRuns) => {
  const [stream, setStream] = useState<{ runId: string; connected: boolean } | null>(null);
  useEffect(() => {
    if (demo || !selectedRunId || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/runs/${selectedRunId}/events`);
    source.onopen = () => setStream({ runId: selectedRunId, connected: true });
    source.onerror = () => setStream({ runId: selectedRunId, connected: false });
    source.addEventListener("execution-event", (message) => {
      try {
        const event = executionEventSchema.parse(JSON.parse((message as MessageEvent).data));
        setRuns((previous) =>
          previous.map((item) =>
            item.snapshot.id === selectedRunId ? mergeRunEvent(item, event) : item,
          ),
        );
      } catch {
        setStream({ runId: selectedRunId, connected: false });
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
        setStream({ runId: selectedRunId, connected: false });
      }
    });
    return () => source.close();
  }, [demo, selectedRunId, setRuns]);
  return stream?.runId === selectedRunId ? stream.connected : null;
};
