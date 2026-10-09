import type { Evidence } from "../../../domain/evidence.js";
import type { PublicEvent } from "../../../runtime/events.js";

/** One rendered activity row; a streamed message keeps its first chunk's id, time and sequence. */
export type ActivityEntry = PublicEvent & {
  /** Sequence of the newest event folded into this entry. */
  lastSequence: number;
};

const attemptKey = (item: Evidence): string | undefined =>
  item.stepId && item.attemptId ? `${item.stepId}\u0000${item.attemptId}` : undefined;

const isEvent = (item: Evidence): item is PublicEvent => item.kind === "event";

const bySequence = (left: PublicEvent, right: PublicEvent): number =>
  left.sequence - right.sequence;

/**
 * Times at which a human turn interrupted each attempt: a blocking question, or guidance being
 * queued for it. These receipts carry no sequence and the browser keeps them apart from events,
 * so their timestamp is the only ordering signal. The queued record is used because the reply
 * can start streaming before the delivered record is stored.
 */
const turnBoundaries = (evidence: readonly Evidence[]): Map<string, number[]> => {
  const boundaries = new Map<string, number[]>();
  for (const item of evidence) {
    const isBoundary =
      item.kind === "input-request" || (item.kind === "guidance" && item.state === "queued");
    const key = attemptKey(item);
    if (!isBoundary || key === undefined) continue;
    boundaries.set(key, [...(boundaries.get(key) ?? []), Date.parse(item.createdAt)]);
  }
  return boundaries;
};

/** A chunk stored at the same instant as the boundary is treated as written before it. */
const crossesBoundary = (
  boundaries: readonly number[] | undefined,
  before: PublicEvent,
  after: PublicEvent,
): boolean => {
  if (!boundaries) return false;
  const from = Date.parse(before.createdAt);
  const to = Date.parse(after.createdAt);
  return boundaries.some((time) => time >= from && time < to);
};

/** Whether `next` continues the streamed message whose latest chunk is `previous`. */
const continuesMessage = (
  boundaries: ReadonlyMap<string, number[]>,
  key: string,
  previous: PublicEvent,
  next: PublicEvent,
): boolean =>
  next.type === "message" &&
  previous.type === "message" &&
  previous.title === next.title &&
  !crossesBoundary(boundaries.get(key), previous, next);

/**
 * Adapters persist every streamed chunk as its own append-only event. Fold consecutive message
 * chunks of one step attempt into one entry. Any other event of that attempt ends the message, as
 * does a blocking question or guidance for it, so the agent's reply starts a new entry.
 * Grouping depends only on the attempt's own evidence, so chunks of parallel attempts interleave
 * without splitting each other and scoping before or after coalescing gives the same entries.
 * Events without an attempt are never merged and, by design, do not end an attempt's message:
 * they belong to the run, not to the agent turn that is streaming.
 */
export const coalesceActivity = (evidence: readonly Evidence[]): ActivityEntry[] => {
  const boundaries = turnBoundaries(evidence);
  const entries: ActivityEntry[] = [];
  // Per attempt: index of the open message entry and the latest chunk folded into it.
  const openMessages = new Map<string, { index: number; latest: PublicEvent }>();
  for (const event of evidence.filter(isEvent).sort(bySequence)) {
    const key = attemptKey(event);
    const open = key === undefined ? undefined : openMessages.get(key);
    const entry = open && entries[open.index];
    if (
      key !== undefined &&
      open &&
      entry &&
      continuesMessage(boundaries, key, open.latest, event)
    ) {
      const detail = `${entry.detail ?? ""}${event.detail ?? ""}`;
      entries[open.index] = {
        ...entry,
        ...(detail ? { detail } : {}),
        lastSequence: event.sequence,
      };
      openMessages.set(key, { index: open.index, latest: event });
      continue;
    }
    entries.push({ ...event, lastSequence: event.sequence });
    if (key === undefined) continue;
    if (event.type === "message")
      openMessages.set(key, { index: entries.length - 1, latest: event });
    else openMessages.delete(key);
  }
  return entries;
};

/** Newest sequence represented by the entries, so growth of an existing message counts as live. */
export const latestSequence = (entries: readonly ActivityEntry[]): number =>
  entries.reduce((latest, entry) => Math.max(latest, entry.lastSequence), -1);

const previewLimit = 120;

/** Last non-empty line of the text, whitespace-collapsed and cut to its newest characters. */
const previewLine = (text: string, truncatedStart: boolean): string | undefined => {
  const lines = text.split("\n");
  const index = lines.reduce((found, line, position) => (line.trim() ? position : found), -1);
  if (index === -1) return undefined;
  const line = (lines[index] ?? "").replace(/\s+/g, " ").trim();
  const clipped = (index === 0 && truncatedStart) || line.length > previewLimit;
  return clipped ? `…${line.slice(-(previewLimit - 1)).trimStart()}` : line;
};

/**
 * Short label for the most recently updated entry. A streamed message previews the live edge of
 * its text, bounded so it stays usable inside a row's accessible name. Only the trailing chunks of
 * that message are read, so a long run is not re-coalesced to show one line.
 */
export const activityPreview = (evidence: readonly Evidence[]): string | undefined => {
  const events = evidence.filter(isEvent).sort(bySequence);
  const latest = events.at(-1);
  if (!latest) return undefined;
  const key = attemptKey(latest);
  if (latest.type !== "message" || key === undefined) return latest.title;
  const boundaries = turnBoundaries(evidence);
  let text = "";
  let previous: PublicEvent | undefined;
  for (const event of [...events].reverse()) {
    if (attemptKey(event) !== key) continue;
    if (previous && !continuesMessage(boundaries, key, event, previous))
      return previewLine(text, false) ?? latest.title;
    text = `${event.detail ?? ""}${text}`;
    previous = event;
    // Enough text for a complete last line, or more than the preview can show.
    if (text.trimEnd().includes("\n") || text.length > previewLimit * 4)
      return previewLine(text, true) ?? latest.title;
  }
  return previewLine(text, false) ?? latest.title;
};

/** The title is only worth showing when it says more than the type label beside it. */
export const showsTitle = (entry: PublicEvent): boolean => entry.title !== entry.type;

/**
 * Agent prose (messages and completion summaries) is Markdown; tool, check and lifecycle output
 * is shown as written, because formatting would change logs and command output.
 */
export const isAgentText = (entry: PublicEvent): boolean =>
  entry.type === "message" || (entry.type === "lifecycle" && entry.title === "completed");
