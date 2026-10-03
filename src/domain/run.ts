import { randomUUID } from "node:crypto";
import { z } from "zod";
import { executionBindingSchema, parseLoop, loopSchema, type ExecutionBinding } from "./loop.js";
import { evidenceSchema } from "./evidence.js";

export const taskSchema = z.strictObject({
  description: z.string().trim().min(1),
  ticket: z
    .strictObject({ id: z.string().min(1), title: z.string().min(1), summary: z.string().min(1) })
    .optional(),
});
export const baselineSchema = z
  .strictObject({
    id: z.string().min(1),
    kind: z.enum(["git", "unversioned"]),
    revision: z.string().min(1).optional(),
    capturedAt: z.iso.datetime(),
  })
  .refine((baseline) => baseline.kind !== "git" || Boolean(baseline.revision), {
    message: "Git baselines require a revision.",
    path: ["revision"],
  });
export type Baseline = z.infer<typeof baselineSchema>;
export const runSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(2),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  task: taskSchema,
  loop: loopSchema,
  projectDefault: executionBindingSchema,
  bindings: z.record(z.string(), executionBindingSchema),
  baseline: baselineSchema,
});
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;
export const attemptSchema = z.strictObject({
  id: z.uuid(),
  number: z.number().int().positive(),
  implementationRound: z.number().int().positive(),
  status: z.enum(["running", "succeeded", "failed", "canceled"]),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
});
export const stepRunSchema = z.strictObject({
  id: z.uuid(),
  stepId: z.string(),
  status: z.enum(["pending", "running", "waiting", "succeeded", "failed", "skipped"]),
  attempts: z.array(attemptSchema),
});
export const implementationRoundSchema = z.strictObject({
  id: z.uuid(),
  number: z.number().int().positive(),
  startedAt: z.iso.datetime(),
});
export const runRecordSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    revision: z.number().int().nonnegative(),
    snapshot: runSnapshotSchema,
    status: z.enum(["pending", "running", "waiting", "succeeded", "failed", "canceled"]),
    implementationRound: z.number().int().positive(),
    rounds: z.array(implementationRoundSchema).min(1),
    steps: z.array(stepRunSchema),
    evidence: z.array(evidenceSchema),
  })
  .superRefine((record, context) => {
    const ids = record.snapshot.loop.steps.map((step) => step.id);
    const report = (message: string) => context.addIssue({ code: "custom", message });
    if (record.snapshot.loop.status !== "published") report("Run loop must be published.");
    if (record.implementationRound > record.snapshot.loop.policy.maxImplementationRounds)
      report("Implementation round exceeds loop policy.");
    if (
      record.rounds.length !== record.implementationRound ||
      record.rounds.some((round, index) => round.number !== index + 1) ||
      new Set(record.rounds.map((round) => round.id)).size !== record.rounds.length
    )
      report("Implementation round history must have stable consecutive identities.");
    if (
      record.steps.length !== ids.length ||
      record.steps.some((step) => !ids.includes(step.stepId)) ||
      new Set(record.steps.map((step) => step.stepId)).size !== ids.length
    )
      report("Run steps must match the loop snapshot exactly.");
    if (new Set(record.steps.map((step) => step.id)).size !== record.steps.length)
      report("Step run IDs must be unique.");
    const attempts = record.steps.flatMap((step) => step.attempts);
    if (new Set(attempts.map((attempt) => attempt.id)).size !== attempts.length)
      report("Attempt IDs must be unique.");
    for (const step of record.steps) {
      if (step.attempts.length > record.snapshot.loop.policy.maxAttemptsPerStep)
        report(`Step ${step.stepId} exceeds attempt policy.`);
      const active = step.attempts.filter((attempt) => attempt.status === "running");
      if (active.length > 1 || (active.length === 1 && step.attempts.at(-1) !== active[0]))
        report(`Step ${step.stepId} has overlapping attempts.`);
      if ((step.status === "running") !== (active.length === 1))
        report(`Step ${step.stepId} status disagrees with its active attempt.`);
      step.attempts.forEach((attempt, index) => {
        if (attempt.number !== index + 1)
          report(`Step ${step.stepId} attempt numbers must be consecutive.`);
        if (attempt.implementationRound > record.implementationRound)
          report(`Step ${step.stepId} attempt refers to a future round.`);
        if (
          index > 0 &&
          attempt.implementationRound < step.attempts[index - 1]!.implementationRound
        )
          report(`Step ${step.stepId} attempt rounds must be monotonic.`);
        if ((attempt.status === "running") === Boolean(attempt.endedAt))
          report(`Step ${step.stepId} attempt ${attempt.number} has an invalid end time.`);
        if (Boolean(attempt.sessionId) !== Boolean(attempt.turnId))
          report(`Step ${step.stepId} attempt ${attempt.number} has incomplete resume identity.`);
      });
    }
    if (
      Object.keys(record.snapshot.bindings).length !== ids.length ||
      ids.some((id) => !record.snapshot.bindings[id])
    )
      report("Resolved bindings must match loop steps exactly.");
    for (const step of record.snapshot.loop.steps) {
      const expected = step.binding ?? record.snapshot.projectDefault;
      if (JSON.stringify(record.snapshot.bindings[step.id]) !== JSON.stringify(expected))
        report(
          `Resolved binding for ${step.id} differs from the selected loop and project default.`,
        );
    }
    const evidenceIds = new Set<string>();
    const eventSequences = new Set<number>();
    for (const receipt of record.evidence) {
      if (evidenceIds.has(receipt.id)) report(`Duplicate evidence ID ${receipt.id}.`);
      if (receipt.kind === "event") {
        if (eventSequences.has(receipt.sequence))
          report(`Duplicate event sequence ${receipt.sequence}.`);
        eventSequences.add(receipt.sequence);
      }
      if (receipt.runId !== record.snapshot.id) report("Evidence references another run.");
      if (receipt.stepId && !ids.includes(receipt.stepId))
        report("Evidence references a missing step.");
      if (receipt.attemptId && !attempts.some((attempt) => attempt.id === receipt.attemptId))
        report("Evidence references a missing attempt.");
      if (
        receipt.attemptId &&
        receipt.stepId &&
        !record.steps.some(
          (step) =>
            step.stepId === receipt.stepId &&
            step.attempts.some((attempt) => attempt.id === receipt.attemptId),
        )
      )
        report("Evidence attempt does not belong to its step.");
      if ("provenance" in receipt) {
        for (const inputId of receipt.provenance.inputReceiptIds)
          if (!evidenceIds.has(inputId))
            report(
              `Evidence ${receipt.id} references a missing or later input receipt ${inputId}.`,
            );
        if (receipt.provenance.baselineId !== record.snapshot.baseline.id)
          report("Evidence baseline does not match the run snapshot.");
        if (
          receipt.freshness.state === "current" &&
          receipt.freshness.checkedAgainstCandidateId !== receipt.provenance.candidateId
        )
          report("Current evidence must be checked against its candidate.");
      }
      evidenceIds.add(receipt.id);
    }
  });
export type RunRecord = z.infer<typeof runRecordSchema>;

/** Snapshot all inputs once; callers supply the actual protected baseline when available. */
export function createRunSnapshot(
  loopInput: unknown,
  taskInput: unknown,
  defaultBinding: ExecutionBinding,
  baselineInput?: Baseline,
): RunSnapshot {
  const loop = parseLoop(loopInput);
  if (loop.status !== "published") throw new Error("Publish the loop before creating a run.");
  const task = taskSchema.parse(taskInput);
  const binding = executionBindingSchema.parse(defaultBinding);
  const baseline = baselineSchema.parse(
    baselineInput ?? {
      id: randomUUID(),
      kind: "unversioned",
      capturedAt: new Date().toISOString(),
    },
  );
  return runSnapshotSchema.parse(
    structuredClone({
      schemaVersion: 2,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      task,
      loop,
      projectDefault: binding,
      bindings: Object.fromEntries(loop.steps.map((step) => [step.id, step.binding ?? binding])),
      baseline,
    }),
  );
}
export function createRunRecord(snapshot: RunSnapshot): RunRecord {
  return runRecordSchema.parse({
    schemaVersion: 2,
    revision: 0,
    snapshot,
    status: "pending",
    implementationRound: 1,
    rounds: [{ id: randomUUID(), number: 1, startedAt: new Date().toISOString() }],
    steps: snapshot.loop.steps.map((step) => ({
      id: randomUUID(),
      stepId: step.id,
      status: "pending",
      attempts: [],
    })),
    evidence: [],
  });
}
/** A retry increments the attempt only. Repair scheduling explicitly advances the round. */
export function startAttempt(record: RunRecord, stepId: string): RunRecord {
  const step = record.steps.find((item) => item.stepId === stepId);
  if (!step) throw new Error(`Unknown step: ${stepId}`);
  if (step.attempts.length >= record.snapshot.loop.policy.maxAttemptsPerStep)
    throw new Error(`Attempt limit reached for ${stepId}.`);
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
                id: randomUUID(),
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
}
export function finishAttempt(
  record: RunRecord,
  stepId: string,
  status: "succeeded" | "failed" | "canceled",
): RunRecord {
  const step = record.steps.find((item) => item.stepId === stepId);
  if (!step?.attempts.some((attempt) => attempt.status === "running"))
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
              attempt.status === "running"
                ? { ...attempt, status, endedAt: new Date().toISOString() }
                : attempt,
            ),
          }
        : item,
    ),
  });
}
/** Record native resume handles once the adapter returns them; they remain fixed afterward. */
export function attachAttemptSession(
  record: RunRecord,
  stepId: string,
  sessionId: string,
  turnId: string,
): RunRecord {
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
}
export function advanceImplementationRound(record: RunRecord): RunRecord {
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
        id: randomUUID(),
        number: record.implementationRound + 1,
        startedAt: new Date().toISOString(),
      },
    ],
  });
}
export function migrateRun(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const value = input as Record<string, unknown>;
  // The foundation's detached snapshots predated a schemaVersion field.
  if (
    value.schemaVersion !== 1 &&
    !(value.schemaVersion === undefined && "loop" in value && "bindings" in value)
  )
    return input;
  const loop = parseLoop(value.loop);
  const priorBindings =
    value.bindings && typeof value.bindings === "object" && !Array.isArray(value.bindings)
      ? (value.bindings as Record<string, unknown>)
      : {};
  const unboundStep = loop.steps.find((step) => !step.binding);
  const binding = executionBindingSchema.parse(
    value.projectDefault ??
      (unboundStep && priorBindings[unboundStep.id]) ??
      Object.values(priorBindings)[0],
  );
  return {
    ...value,
    schemaVersion: 2,
    loop,
    projectDefault: binding,
    baseline: value.baseline ?? {
      id: `legacy-${value.id}`,
      kind: "unversioned",
      capturedAt: value.createdAt,
    },
  };
}
