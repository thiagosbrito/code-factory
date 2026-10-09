import { runRecordSchema, type RunRecord } from "./run-record.js";
import { hasRetryBudget } from "./run-retry.js";

/** A retry increments the attempt only. Repair scheduling explicitly advances the round. */
export const startAttempt = (record: RunRecord, stepId: string): RunRecord => {
  const step = record.steps.find((item) => item.stepId === stepId);
  if (!step) throw new Error(`Unknown step: ${stepId}`);
  if (!hasRetryBudget(record, step)) throw new Error(`Attempt limit reached for ${stepId}.`);
  if (step.attempts.some((attempt) => attempt.status === "running"))
    throw new Error(`Step ${stepId} already has a running attempt.`);
  return runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    status: "running",
    steps: record.steps.map((item) =>
      item.stepId === stepId
        ? {
            ...item,
            status: "running",
            attempts: [
              ...item.attempts,
              {
                id: crypto.randomUUID(),
                number: item.attempts.length + 1,
                implementationRound: record.implementationRound,
                status: "running",
                startedAt: new Date().toISOString(),
              },
            ],
          }
        : item,
    ),
  });
};

export const finishAttempt = (
  record: RunRecord,
  stepId: string,
  status: "succeeded" | "failed" | "canceled",
): RunRecord => {
  const step = record.steps.find((item) => item.stepId === stepId);
  if (
    !step?.attempts.some((attempt) =>
      ["running", "waiting-input", "paused"].includes(attempt.status),
    )
  )
    throw new Error(`No running attempt for ${stepId}.`);
  return runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    steps: record.steps.map((item) =>
      item.stepId === stepId
        ? {
            ...item,
            status: status === "canceled" ? "waiting" : status,
            attempts: item.attempts.map((attempt) =>
              ["running", "waiting-input", "paused"].includes(attempt.status)
                ? { ...attempt, status, endedAt: new Date().toISOString() }
                : attempt,
            ),
          }
        : item,
    ),
  });
};

/** Record native resume handles once the adapter returns them; they remain fixed afterward. */
export const attachAttemptSession = (
  record: RunRecord,
  stepId: string,
  sessionId: string,
  turnId: string,
): RunRecord => {
  const step = record.steps.find((item) => item.stepId === stepId);
  const attempt = step?.attempts.at(-1);
  if (!attempt || attempt.status !== "running" || attempt.sessionId || attempt.turnId)
    throw new Error(`No unattached running attempt for ${stepId}.`);
  if (!sessionId || !turnId) throw new Error("Session and turn IDs are required.");
  return runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    steps: record.steps.map((item) =>
      item.stepId === stepId
        ? {
            ...item,
            attempts: item.attempts.map((entry) =>
              entry.id === attempt.id ? { ...entry, sessionId, turnId } : entry,
            ),
          }
        : item,
    ),
  });
};

export const setAttemptControlState = (
  record: RunRecord,
  stepId: string,
  attemptId: string,
  status: "running" | "waiting-input" | "paused",
): RunRecord => {
  const step = record.steps.find((item) => item.stepId === stepId);
  const attempt = step?.attempts.at(-1);
  if (
    !attempt ||
    attempt.id !== attemptId ||
    !["running", "waiting-input", "paused"].includes(attempt.status)
  )
    throw new Error(`No active attempt for ${stepId}.`);
  return runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    status: status === "running" ? "running" : status,
    steps: record.steps.map((item) =>
      item.stepId === stepId
        ? {
            ...item,
            status,
            attempts: item.attempts.map((entry) =>
              entry.id === attemptId ? { ...entry, status } : entry,
            ),
          }
        : item,
    ),
  });
};

export const advanceImplementationRound = (record: RunRecord): RunRecord => {
  if (record.implementationRound >= record.snapshot.loop.policy.maxImplementationRounds)
    throw new Error("Implementation round limit reached.");
  if (record.steps.some((step) => step.attempts.some((attempt) => attempt.status === "running")))
    throw new Error("Finish active attempts before repair.");
  return runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    implementationRound: record.implementationRound + 1,
    rounds: [
      ...record.rounds,
      {
        id: crypto.randomUUID(),
        number: record.implementationRound + 1,
        startedAt: new Date().toISOString(),
      },
    ],
  });
};
