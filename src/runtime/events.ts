import type { ServerResponse } from "node:http";
import type { RunRecord } from "../domain/run.js";
import { readRun } from "./storage.js";

export type PublicEvent = Extract<RunRecord["evidence"][number], { kind: "event" }>;

/** A cursor names the last committed event, not a socket or process-local offset. */
export const eventsAfter = (record: RunRecord, cursor: number): PublicEvent[] =>
  record.evidence.filter(
    (item): item is PublicEvent => item.kind === "event" && item.sequence > cursor,
  );

export const parseEventCursor = (value: string | undefined): number => {
  if (value === undefined || value === "") return -1;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Invalid event cursor.");
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor)) throw new Error("Invalid event cursor.");
  return cursor;
};

/** Event-only revisions do not change the execution state shown beside the feed. */
const executionStateKey = (record: RunRecord): string =>
  JSON.stringify({
    status: record.status,
    round: record.implementationRound,
    steps: record.steps.map((step) => ({
      status: step.status,
      outcome: step.outcome,
      candidateId: step.candidateId,
      attempts: step.attempts.map((attempt) => attempt.status),
    })),
  });

/** Re-read durable state for every batch, so a subscriber never owns execution. */
export const streamRunEvents = async (
  project: string,
  runId: string,
  response: ServerResponse,
  cursor: number,
): Promise<void> => {
  const initial = await readRun(project, runId);
  if (!initial) throw new Error("Run not found.");
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
  });
  let last = cursor;
  let stateKey = "";
  let reading = false;
  const send = (name: string, data: unknown, id?: number) => {
    response.write(
      `${id === undefined ? "" : `id: ${id}\n`}event: ${name}\ndata: ${JSON.stringify(data)}\n\n`,
    );
  };
  const poll = async () => {
    if (reading || response.destroyed) return;
    reading = true;
    try {
      const record = await readRun(project, runId);
      if (!record) throw new Error("Run disappeared.");
      for (const event of eventsAfter(record, last)) {
        send("execution-event", event, event.sequence);
        last = event.sequence;
      }
      const nextStateKey = executionStateKey(record);
      if (nextStateKey !== stateKey) {
        send("run-state", record);
        stateKey = nextStateKey;
      }
      response.write(": keepalive\n\n");
    } catch {
      response.end();
    } finally {
      reading = false;
    }
  };
  await poll();
  const timer = setInterval(() => void poll(), 250);
  response.on("close", () => clearInterval(timer));
};
