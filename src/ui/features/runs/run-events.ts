import type { RunRecord } from "../../../domain/run.js";
import type { PublicEvent } from "../../../domain/evidence.js";

/** Socket frames can arrive beside an older snapshot; keep each event once by sequence. */
export const mergeRunEvent = (record: RunRecord, event: PublicEvent): RunRecord => {
  if (event.runId !== record.snapshot.id) return record;
  if (record.evidence.some((item) => item.kind === "event" && item.sequence === event.sequence))
    return record;
  const receipts = record.evidence.filter((item) => item.kind !== "event");
  const events = [
    ...record.evidence.filter((item): item is PublicEvent => item.kind === "event"),
    event,
  ].sort((a, b) => a.sequence - b.sequence);
  return { ...record, evidence: [...events, ...receipts] };
};

export const mergeRunSnapshot = (current: RunRecord, incoming: RunRecord): RunRecord => {
  if (current.snapshot.id !== incoming.snapshot.id || incoming.revision < current.revision)
    return current;
  return current.evidence
    .filter((item): item is PublicEvent => item.kind === "event")
    .reduce(mergeRunEvent, incoming);
};
