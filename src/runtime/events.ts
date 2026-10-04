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
  let revision = -1;
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
      if (record.revision !== revision) {
        send("run-state", record);
        revision = record.revision;
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
