import {
  type RunRecordShape,
  type StepRun,
  type Attempt,
  type Receipt,
  type Report,
} from "./run-schema.js";

export const hasDuplicates = <T>(values: T[]): boolean => {
  return new Set(values).size !== values.length;
};

export const validateRoundHistory = (record: RunRecordShape, report: Report): void => {
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

export const validateAttempt = (
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

export const validateStepRun = (step: StepRun, record: RunRecordShape, report: Report): void => {
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

export const validateSteps = (record: RunRecordShape, report: Report): void => {
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

export const validateBindings = (record: RunRecordShape, report: Report): void => {
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

export const validateProvenance = (
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

export const validateEvidence = (record: RunRecordShape, report: Report): void => {
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
