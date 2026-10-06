import { z } from "zod";
import { executionBindingSchema, parseLoop, loopSchema, type ExecutionBinding } from "./loop.js";
import { evidenceSchema } from "./evidence.js";

export const taskSchema = z
  .strictObject({
    description: z.string().trim(),
    ticket: z
      .strictObject({
        id: z.string().min(1),
        title: z.string().min(1),
        summary: z.string(),
        attachments: z
          .array(z.strictObject({ title: z.string().min(1), url: z.url() }))
          .default([]),
      })
      .optional(),
  })
  .refine(
    (task) => Boolean(task.description || task.ticket),
    "Enter a description or retrieve a ticket.",
  );
export const baselineSchema = z
  .strictObject({
    id: z.string().min(1),
    kind: z.enum(["git", "unversioned"]),
    revision: z.string().min(1).optional(),
    sourceRevision: z.string().min(1).optional(),
    workspace: z.string().min(1).optional(),
    changes: z.array(z.string()).optional(),
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
  status: z.enum([
    "running",
    "waiting-input",
    "paused",
    "succeeded",
    "failed",
    "canceled",
    "interrupted",
  ]),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
});
export const stepRunSchema = z.strictObject({
  id: z.uuid(),
  stepId: z.string(),
  status: z.enum([
    "pending",
    "running",
    "waiting",
    "waiting-input",
    "paused",
    "succeeded",
    "failed",
    "skipped",
  ]),
  outcome: z.string().optional(),
  candidateId: z.string().optional(),
  inputHash: z.string().optional(),
  attempts: z.array(attemptSchema),
});
export const implementationRoundSchema = z.strictObject({
  id: z.uuid(),
  number: z.number().int().positive(),
  startedAt: z.iso.datetime(),
});
const baseRunRecordSchema = z.strictObject({
  schemaVersion: z.literal(2),
  revision: z.number().int().nonnegative(),
  snapshot: runSnapshotSchema,
  status: z.enum([
    "pending",
    "running",
    "waiting",
    "waiting-input",
    "paused",
    "succeeded",
    "failed",
    "canceled",
    "rejected",
    "unavailable",
    "blocked",
  ]),
  implementationRound: z.number().int().positive(),
  rounds: z.array(implementationRoundSchema).min(1),
  steps: z.array(stepRunSchema),
  evidence: z.array(evidenceSchema),
});

type RunRecordShape = z.infer<typeof baseRunRecordSchema>;
type StepRun = RunRecordShape["steps"][number];
type Attempt = StepRun["attempts"][number];
type Receipt = RunRecordShape["evidence"][number];
type Report = (message: string) => void;

const hasDuplicates = <T>(values: T[]): boolean => {
  return new Set(values).size !== values.length;
};

const validateRoundHistory = (record: RunRecordShape, report: Report): void => {
  if (record.implementationRound > record.snapshot.loop.policy.maxImplementationRounds)
    report("Implementation round exceeds loop policy.");
  const hasConsecutiveNumbers = record.rounds.every(({ number }, index) => number === index + 1);
  if (
    record.rounds.length !== record.implementationRound ||
    !hasConsecutiveNumbers ||
    hasDuplicates(record.rounds.map(({ id }) => id))
  )
    report("Implementation round history must have stable consecutive identities.");
};

const validateAttempt = (
  attempt: Attempt,
  previous: Attempt | undefined,
  index: number,
  stepId: string,
  currentRound: number,
  report: Report,
): void => {
  if (attempt.number !== index + 1) report(`Step ${stepId} attempt numbers must be consecutive.`);
  if (attempt.implementationRound > currentRound)
    report(`Step ${stepId} attempt refers to a future round.`);
  if (previous && attempt.implementationRound < previous.implementationRound)
    report(`Step ${stepId} attempt rounds must be monotonic.`);
  if (["running", "waiting-input", "paused"].includes(attempt.status) === Boolean(attempt.endedAt))
    report(`Step ${stepId} attempt ${attempt.number} has an invalid end time.`);
  if (Boolean(attempt.sessionId) !== Boolean(attempt.turnId))
    report(`Step ${stepId} attempt ${attempt.number} has incomplete resume identity.`);
};

const validateStepRun = (step: StepRun, record: RunRecordShape, report: Report): void => {
  if (
    record.rounds.some(
      (round) =>
        step.attempts.filter((attempt) => attempt.implementationRound === round.number).length >
        record.snapshot.loop.policy.maxAttemptsPerStep,
    )
  )
    report(`Step ${step.stepId} exceeds attempt policy.`);
  const active = step.attempts.filter(({ status }) =>
    ["running", "waiting-input", "paused"].includes(status),
  );
  if (active.length > 1 || (active.length === 1 && step.attempts.at(-1) !== active[0]))
    report(`Step ${step.stepId} has overlapping attempts.`);
  if (
    ["running", "waiting-input", "paused"].includes(step.status) !== (active.length === 1) ||
    (active[0] && step.status !== active[0].status)
  )
    report(`Step ${step.stepId} status disagrees with its active attempt.`);
  step.attempts.forEach((attempt, index) =>
    validateAttempt(
      attempt,
      step.attempts[index - 1],
      index,
      step.stepId,
      record.implementationRound,
      report,
    ),
  );
};

const validateSteps = (record: RunRecordShape, report: Report): void => {
  const loopStepIds = record.snapshot.loop.steps.map(({ id }) => id);
  const runStepIds = record.steps.map(({ stepId }) => stepId);
  if (
    runStepIds.length !== loopStepIds.length ||
    runStepIds.some((id) => !loopStepIds.includes(id)) ||
    hasDuplicates(runStepIds)
  )
    report("Run steps must match the loop snapshot exactly.");
  if (hasDuplicates(record.steps.map(({ id }) => id))) report("Step run IDs must be unique.");
  const attempts = record.steps.flatMap(({ attempts }) => attempts);
  if (hasDuplicates(attempts.map(({ id }) => id))) report("Attempt IDs must be unique.");
  for (const step of record.steps) validateStepRun(step, record, report);
};

const validateBindings = (record: RunRecordShape, report: Report): void => {
  const { loop, bindings, projectDefault } = record.snapshot;
  const stepIds = loop.steps.map(({ id }) => id);
  if (Object.keys(bindings).length !== stepIds.length || stepIds.some((id) => !bindings[id]))
    report("Resolved bindings must match loop steps exactly.");
  for (const step of loop.steps) {
    const expected = step.binding ?? projectDefault;
    if (JSON.stringify(bindings[step.id]) !== JSON.stringify(expected))
      report(`Resolved binding for ${step.id} differs from the selected loop and project default.`);
  }
};

const validateProvenance = (
  receipt: Receipt,
  record: RunRecordShape,
  precedingIds: Set<string>,
  report: Report,
): void => {
  if (!("provenance" in receipt)) return;
  for (const inputId of receipt.provenance.inputReceiptIds) {
    if (!precedingIds.has(inputId))
      report(`Evidence ${receipt.id} references a missing or later input receipt ${inputId}.`);
  }
  if (receipt.provenance.baselineId !== record.snapshot.baseline.id)
    report("Evidence baseline does not match the run snapshot.");
  if (
    receipt.freshness.state === "current" &&
    receipt.freshness.checkedAgainstCandidateId !== receipt.provenance.candidateId
  )
    report("Current evidence must be checked against its candidate.");
};

const validateEvidence = (record: RunRecordShape, report: Report): void => {
  const evidenceIds = new Set<string>();
  const eventSequences = new Set<number>();
  let lastEventSequence = -1;
  const stepIds = new Set(record.snapshot.loop.steps.map(({ id }) => id));
  const attemptOwners = new Map(
    record.steps.flatMap((step) =>
      step.attempts.map((attempt) => [attempt.id, step.stepId] as const),
    ),
  );
  const attemptsById = new Map(
    record.steps.flatMap((step) => step.attempts.map((attempt) => [attempt.id, attempt] as const)),
  );
  for (const receipt of record.evidence) {
    if (evidenceIds.has(receipt.id)) report(`Duplicate evidence ID ${receipt.id}.`);
    if (receipt.kind === "event" && eventSequences.has(receipt.sequence))
      report(`Duplicate event sequence ${receipt.sequence}.`);
    if (receipt.kind === "event") {
      if (receipt.sequence !== lastEventSequence + 1)
        report("Event sequences must be contiguous in persisted order.");
      lastEventSequence = receipt.sequence;
      eventSequences.add(receipt.sequence);
      if (Boolean(receipt.sessionId) !== Boolean(receipt.turnId))
        report("Event has incomplete native session identity.");
      if (
        receipt.sessionId &&
        receipt.attemptId &&
        (attemptsById.get(receipt.attemptId)?.sessionId !== receipt.sessionId ||
          attemptsById.get(receipt.attemptId)?.turnId !== receipt.turnId)
      )
        report("Event native session does not match its attempt.");
    }
    if (receipt.kind === "input-request") {
      const attempt = attemptsById.get(receipt.attemptId);
      if (attempt?.sessionId !== receipt.sessionId || attempt.turnId !== receipt.turnId)
        report("Input request native session does not match its attempt.");
    }
    if (receipt.kind === "input-reply") {
      const request = record.evidence.find((item) => item.id === receipt.requestEvidenceId);
      if (
        !request ||
        request.kind !== "input-request" ||
        !evidenceIds.has(request.id) ||
        request.attemptId !== receipt.attemptId ||
        request.stepId !== receipt.stepId
      )
        report("Input reply references a missing or mismatched request.");
    }
    if (receipt.runId !== record.snapshot.id) report("Evidence references another run.");
    if (receipt.stepId && !stepIds.has(receipt.stepId))
      report("Evidence references a missing step.");
    if (receipt.attemptId && !attemptOwners.has(receipt.attemptId))
      report("Evidence references a missing attempt.");
    if (
      receipt.attemptId &&
      receipt.stepId &&
      attemptOwners.get(receipt.attemptId) !== receipt.stepId
    )
      report("Evidence attempt does not belong to its step.");
    validateProvenance(receipt, record, evidenceIds, report);
    evidenceIds.add(receipt.id);
  }
};

export const runRecordSchema = baseRunRecordSchema.superRefine((record, context) => {
  const report: Report = (message) => context.addIssue({ code: "custom", message });
  if (record.snapshot.loop.status !== "published") report("Run loop must be published.");
  validateRoundHistory(record, report);
  validateSteps(record, report);
  validateBindings(record, report);
  validateEvidence(record, report);
});
export type RunRecord = z.infer<typeof runRecordSchema>;

/** Snapshot all inputs once; callers supply the actual protected baseline when available. */
export const createRunSnapshot = (
  loopInput: unknown,
  taskInput: unknown,
  defaultBinding: ExecutionBinding,
  baselineInput?: Baseline,
  id: string = crypto.randomUUID(),
): RunSnapshot => {
  const loop = parseLoop(loopInput);
  if (loop.status !== "published") throw new Error("Publish the loop before creating a run.");
  const task = taskSchema.parse(taskInput);
  const binding = executionBindingSchema.parse(defaultBinding);
  const baseline = baselineSchema.parse(
    baselineInput ?? {
      id: crypto.randomUUID(),
      kind: "unversioned",
      capturedAt: new Date().toISOString(),
    },
  );
  return runSnapshotSchema.parse(
    structuredClone({
      schemaVersion: 2,
      id,
      createdAt: new Date().toISOString(),
      task,
      loop,
      projectDefault: binding,
      bindings: Object.fromEntries(loop.steps.map((step) => [step.id, step.binding ?? binding])),
      baseline,
    }),
  );
};
export const createRunRecord = (snapshot: RunSnapshot): RunRecord => {
  return runRecordSchema.parse({
    schemaVersion: 2,
    revision: 0,
    snapshot,
    status: "pending",
    implementationRound: 1,
    rounds: [{ id: crypto.randomUUID(), number: 1, startedAt: new Date().toISOString() }],
    steps: snapshot.loop.steps.map((step) => ({
      id: crypto.randomUUID(),
      stepId: step.id,
      status: "pending",
      attempts: [],
    })),
    evidence: [],
  });
};
/** A retry increments the attempt only. Repair scheduling explicitly advances the round. */
export const startAttempt = (record: RunRecord, stepId: string): RunRecord => {
  const step = record.steps.find((item) => item.stepId === stepId);
  if (!step) throw new Error(`Unknown step: ${stepId}`);
  if (
    step.attempts.filter((attempt) => attempt.implementationRound === record.implementationRound)
      .length >= record.snapshot.loop.policy.maxAttemptsPerStep
  )
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
export const migrateRun = (input: unknown): unknown => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const value = z.record(z.string(), z.unknown()).parse(input);
  // The foundation's detached snapshots predated a schemaVersion field.
  if (
    value.schemaVersion !== 1 &&
    !(value.schemaVersion === undefined && "loop" in value && "bindings" in value)
  )
    return input;
  const loop = parseLoop(value.loop);
  const priorBindings =
    value.bindings && typeof value.bindings === "object" && !Array.isArray(value.bindings)
      ? z.record(z.string(), z.unknown()).parse(value.bindings)
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
};
