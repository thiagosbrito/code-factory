import { type AdapterEvent } from "../adapters/contract.js";
import { runRecordSchema, setAttemptControlState, type RunRecord } from "../domain/run.js";
import { type StepResult } from "../domain/scheduler.js";
import { appendScopedEvent } from "../domain/run-branch.js";
import { acknowledgeGuidance } from "./guidance.js";
import { snapshotFileDiffs } from "./inspection.js";
import { isActiveStatus } from "./scheduler-constants.js";

export type FileSnapshot = Awaited<ReturnType<typeof snapshotFileDiffs>>[number];

export const diffLineCounts = (diff: string) =>
  diff.split("\n").reduce(
    (counts, line) => ({
      additions: counts.additions + (line.startsWith("+") && !line.startsWith("+++ ") ? 1 : 0),
      deletions: counts.deletions + (line.startsWith("-") && !line.startsWith("--- ") ? 1 : 0),
    }),
    { additions: 0, deletions: 0 },
  );

export const appendFileReceipts = (
  record: RunRecord,
  stepId: string,
  attemptId: string,
  before: FileSnapshot[],
  after: FileSnapshot[],
  inputReceiptIds: string[],
  source: "agent" | "check",
  stale: boolean,
): RunRecord => {
  const candidateId = record.steps.find((item) => item.stepId === stepId)?.candidateId;
  if (!candidateId) return record;
  const previous = new Map(before.map((item) => [item.change.path, item.digest]));
  const produced = after.filter((item) => previous.get(item.change.path) !== item.digest);
  if (!produced.length) return record;
  return runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    evidence: [
      ...record.evidence,
      ...produced.map(({ change, diff, digest }) => ({
        id: crypto.randomUUID(),
        runId: record.snapshot.id,
        stepId,
        attemptId,
        createdAt: new Date().toISOString(),
        kind: "file" as const,
        path: change.path,
        change: change.change,
        ...(change.previousPath ? { previousPath: change.previousPath } : {}),
        ...diffLineCounts(diff),
        diffDigest: digest,
        provenance: {
          source,
          baselineId: record.snapshot.baseline.id,
          candidateId,
          inputReceiptIds,
        },
        freshness: {
          state: stale ? ("superseded" as const) : ("current" as const),
          checkedAgainstCandidateId: candidateId,
        },
      })),
    ],
  });
};

export const appendEvent = (
  record: RunRecord,
  stepId: string,
  attemptId: string,
  event: AdapterEvent,
): RunRecord => {
  const sequence =
    Math.max(
      -1,
      ...record.evidence.filter((item) => item.kind === "event").map((item) => item.sequence),
    ) + 1;
  const next = runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    evidence: [
      ...record.evidence,
      {
        id: crypto.randomUUID(),
        runId: record.snapshot.id,
        stepId,
        attemptId,
        createdAt: new Date().toISOString(),
        kind: "event",
        type: ["message", "tool", "check", "error"].includes(event.type) ? event.type : "lifecycle",
        title: event.type === "tool" || event.type === "check" ? event.title : event.type,
        detail:
          event.type === "message"
            ? event.text
            : event.type === "error"
              ? event.text
              : event.type === "tool" || event.type === "check"
                ? event.detail
                : event.type === "completed"
                  ? event.output
                  : undefined,
        state:
          event.type === "completed" ? event.outcome : "state" in event ? event.state : undefined,
        sessionId: event.sessionId,
        turnId: event.turnId,
        sequence,
      },
    ],
  });
  const last = next.evidence.at(-1);
  return event.type === "message" && last?.kind === "event"
    ? acknowledgeGuidance(next, stepId, attemptId, last.id)
    : next;
};

export const recordInputRequest = (
  record: RunRecord,
  stepId: string,
  attemptId: string,
  event: Extract<AdapterEvent, { type: "input-request" }>,
): RunRecord => {
  if (!event.isBlocking) throw new Error("Only blocking native requests can wait for input.");
  const waiting = setAttemptControlState(record, stepId, attemptId, "waiting-input");
  return runRecordSchema.parse({
    ...waiting,
    revision: waiting.revision,
    evidence: [
      ...waiting.evidence,
      {
        id: crypto.randomUUID(),
        runId: waiting.snapshot.id,
        stepId,
        attemptId,
        createdAt: new Date().toISOString(),
        kind: "input-request",
        sessionId: event.sessionId,
        turnId: event.turnId,
        itemId: event.itemId,
        requestId: event.requestId,
        questions: event.questions,
        isBlocking: true,
        autoResolutionMs: event.autoResolutionMs,
      },
    ],
  });
};

export const appendLocalEvent = (
  record: RunRecord,
  stepId: string,
  attemptId: string,
  type: "check" | "lifecycle",
  title: string,
  detail?: string,
  state?: string,
): RunRecord => appendScopedEvent(record, { stepId, attemptId }, type, title, detail, state);

export const interruptStep = (
  record: RunRecord,
  stepId: string,
  reason: string,
  title: "recovery-unavailable" | "execution-interrupted",
): RunRecord => {
  const step = record.steps.find((item) => item.stepId === stepId);
  const attempt = step?.attempts.at(-1);
  if (!attempt || !isActiveStatus(attempt.status)) return record;
  const interrupted = runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    status: "unavailable",
    steps: record.steps.map((item) =>
      item.stepId === stepId
        ? {
            ...item,
            status: "waiting",
            attempts: item.attempts.map((entry) =>
              entry.id === attempt.id
                ? { ...entry, status: "interrupted", endedAt: new Date().toISOString() }
                : entry,
            ),
          }
        : item,
    ),
  });
  const sequence =
    Math.max(
      -1,
      ...interrupted.evidence.filter((item) => item.kind === "event").map((item) => item.sequence),
    ) + 1;
  return runRecordSchema.parse({
    ...interrupted,
    revision: interrupted.revision,
    evidence: [
      ...interrupted.evidence,
      {
        id: crypto.randomUUID(),
        runId: record.snapshot.id,
        stepId,
        attemptId: attempt.id,
        createdAt: new Date().toISOString(),
        kind: "event",
        type: "lifecycle",
        title,
        detail: reason,
        state: "unknown",
        ...(attempt.sessionId ? { sessionId: attempt.sessionId, turnId: attempt.turnId } : {}),
        sequence,
      },
    ],
  });
};

export const appendReceipt = (
  record: RunRecord,
  stepId: string,
  attemptId: string,
  instruction: string,
  result: StepResult,
  inputReceiptIds: string[],
  stale: boolean,
): RunRecord => {
  const step = record.steps.find((item) => item.stepId === stepId);
  if (!step?.candidateId || !step.inputHash) throw new Error("Step has no frozen inputs.");
  const definition = record.snapshot.loop.steps.find((item) => item.id === stepId);
  const provenance = {
    source: definition?.kind === "check" ? "check" : "agent",
    baselineId: record.snapshot.baseline.id,
    candidateId: step.candidateId,
    inputReceiptIds,
  };
  const freshness = {
    state: stale ? "superseded" : "current",
    checkedAgainstCandidateId: step.candidateId,
  };
  const common = {
    id: crypto.randomUUID(),
    runId: record.snapshot.id,
    stepId,
    attemptId,
    createdAt: new Date().toISOString(),
    provenance,
    freshness,
  };
  const receipt =
    definition?.kind === "check"
      ? {
          ...common,
          kind: "check",
          command: instruction,
          outcome: result.status === "succeeded" ? "passed" : "failed",
          exitCode: result.exitCode ?? null,
          summary: result.summary ?? "",
          inputHash: step.inputHash,
        }
      : {
          ...common,
          kind: "review",
          scope: instruction,
          verdict:
            result.outcome === "pass"
              ? "pass"
              : result.outcome === "changes-requested"
                ? "changes-requested"
                : "blocked",
          findings: result.findings ?? [],
          inputHash: step.inputHash,
        };
  return runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    evidence: [...record.evidence, receipt],
  });
};
