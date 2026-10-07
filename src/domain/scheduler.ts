import { createHash } from "node:crypto";
import {
  advanceImplementationRound,
  hasRetryBudget,
  runRecordSchema,
  startAttempt,
  type RunRecord,
} from "./run.js";
import { getDependentStepIds } from "./loop.js";

type Step = RunRecord["steps"][number];
type Definition = RunRecord["snapshot"]["loop"]["steps"][number];
const isActiveStatus = (status: string): boolean =>
  status === "running" || status === "waiting-input" || status === "paused";
export type StepResult = {
  status: "succeeded" | "failed" | "canceled" | "unavailable";
  outcome?: string;
  candidateId?: string;
  inputHash?: string;
  exitCode?: number | null;
  summary?: string;
  findings?: string[];
};

const update = (record: RunRecord, steps: Step[], status = record.status): RunRecord =>
  runRecordSchema.parse({ ...record, revision: record.revision + 1, steps, status });

const activeSource = (record: RunRecord, from: string, to: string): boolean => {
  const decision = record.snapshot.loop.decisions.find((item) => item.stepId === from);
  const source = record.steps.find((item) => item.stepId === from);
  if (source?.status === "skipped") return false;
  if (!decision) return true;
  if (source?.status !== "succeeded") return true;
  return decision.branches.some((branch) => branch.to === to && branch.outcome === source.outcome);
};

/** Readiness depends on graph edges and explicit outcomes, never canvas order. */
export const readySteps = (record: RunRecord): Definition[] => {
  if (
    ["failed", "canceled", "rejected", "unavailable", "blocked", "succeeded"].includes(
      record.status,
    )
  )
    return [];
  return record.snapshot.loop.steps.filter((definition) => {
    const step = record.steps.find((item) => item.stepId === definition.id);
    if (step?.status !== "pending") return false;
    const incoming = record.snapshot.loop.dependencies.filter((edge) => edge.to === definition.id);
    const active = incoming.filter((edge) => activeSource(record, edge.from, edge.to));
    const join = record.snapshot.loop.joins.find((item) => item.stepId === definition.id);
    if (join?.mode === "any")
      return active.some(
        (edge) => record.steps.find((item) => item.stepId === edge.from)?.status === "succeeded",
      );
    return (
      active.every(
        (edge) => record.steps.find((item) => item.stepId === edge.from)?.status === "succeeded",
      ) &&
      incoming.every((edge) => {
        const source = record.steps.find((item) => item.stepId === edge.from);
        return source?.status === "succeeded" || source?.status === "skipped";
      }) &&
      (incoming.length === 0 || active.length > 0)
    );
  });
};

/** Skip unreachable branches only once their decision and other inputs settle. */
export const skipInactive = (record: RunRecord): RunRecord => {
  let current = record;
  for (;;) {
    const steps = current.steps.map((step) => {
      if (step.status !== "pending") return step;
      const incoming = current.snapshot.loop.dependencies.filter((edge) => edge.to === step.stepId);
      if (!incoming.length) return step;
      if (
        !incoming.every((edge) =>
          ["succeeded", "skipped"].includes(
            current.steps.find((item) => item.stepId === edge.from)?.status ?? "pending",
          ),
        )
      )
        return step;
      if (incoming.some((edge) => activeSource(current, edge.from, edge.to))) return step;
      return { ...step, status: "skipped" as const };
    });
    if (!steps.some((step, index) => step !== current.steps[index]))
      return current === record ? record : update(record, current.steps);
    current = { ...current, steps };
  }
};

export const claimStep = (
  record: RunRecord,
  stepId: string,
  candidateId: string,
  inputHash: string,
): RunRecord => {
  const definition = readySteps(record).find((step) => step.id === stepId);
  if (!definition) throw new Error(`Step ${stepId} is not ready.`);
  const writer = definition.stage !== "review";
  const active = record.steps.filter((step) => isActiveStatus(step.status));
  if (writer && active.length) throw new Error("Conflicting workspace writer or reader is active.");
  if (
    active.some((step) => {
      const item = record.snapshot.loop.steps.find((definition) => definition.id === step.stepId);
      return item?.stage !== "review";
    })
  )
    throw new Error("Workspace writer is active.");
  const claimed = startAttempt(record, stepId);
  return runRecordSchema.parse({
    ...claimed,
    steps: claimed.steps.map((step) =>
      step.stepId === stepId ? { ...step, candidateId, inputHash } : step,
    ),
  });
};

export const completeStep = (record: RunRecord, stepId: string, result: StepResult): RunRecord => {
  const step = record.steps.find((item) => item.stepId === stepId);
  const attempt = step?.attempts.at(-1);
  if (!step || !attempt || !isActiveStatus(attempt.status))
    throw new Error(`No active attempt for ${stepId}.`);
  if (result.inputHash && result.inputHash !== step.inputHash)
    throw new Error("Step input changed during execution.");
  const decision = record.snapshot.loop.decisions.find((item) => item.stepId === stepId);
  if (
    result.status === "succeeded" &&
    decision &&
    !decision.branches.some((branch) => branch.outcome === result.outcome)
  )
    throw new Error(`Decision ${stepId} returned an undeclared outcome.`);
  const endedAt = new Date().toISOString();
  const steps = record.steps.map((item) =>
    item.stepId === stepId
      ? {
          ...item,
          status:
            result.status === "unavailable" || result.status === "canceled"
              ? ("waiting" as const)
              : result.status,
          outcome: result.outcome,
          candidateId: result.candidateId ?? item.candidateId,
          attempts: item.attempts.map((entry) =>
            entry.id === attempt.id
              ? {
                  ...entry,
                  status: result.status === "unavailable" ? ("failed" as const) : result.status,
                  endedAt,
                }
              : entry,
          ),
        }
      : item,
  );
  const hasRepeat = record.snapshot.loop.groups.some(
    (group) =>
      group.kind === "repeat" &&
      group.exitWhen.stepId === stepId &&
      group.continueWhen.outcome === result.outcome,
  );
  const status =
    result.status === "succeeded"
      ? record.status === "failed" ||
        record.status === "canceled" ||
        record.status === "unavailable" ||
        record.status === "blocked" ||
        record.status === "rejected"
        ? record.status
        : record.snapshot.loop.steps.find((item) => item.id === stepId)?.stage === "review" &&
            result.outcome === "blocked"
          ? "blocked"
          : record.snapshot.loop.steps.find((item) => item.id === stepId)?.stage === "review" &&
              result.outcome === "changes-requested" &&
              !hasRepeat
            ? "rejected"
            : "running"
      : result.status;
  const settled = skipInactive(update(record, steps, status));
  return runRecordSchema.parse({ ...settled, revision: record.revision + 1 });
};

export const settleRun = (record: RunRecord): RunRecord => {
  if (record.steps.some((step) => isActiveStatus(step.status)) || readySteps(record).length)
    return record;
  if (record.status !== "running" && record.status !== "pending") return record;
  const status = record.steps.every((step) => ["succeeded", "skipped"].includes(step.status))
    ? "succeeded"
    : "failed";
  return update(record, record.steps, status);
};

/** A repeat continuation reopens its declared body and advances one implementation round. */
export const continueRepeat = (record: RunRecord, decisionStepId: string): RunRecord => {
  const group = record.snapshot.loop.groups.find(
    (item) => item.kind === "repeat" && item.exitWhen.stepId === decisionStepId,
  );
  if (!group || group.kind !== "repeat") throw new Error("No repeat group owns this decision.");
  const decision = record.steps.find((step) => step.stepId === decisionStepId);
  if (decision?.status !== "succeeded" || decision.outcome !== group.continueWhen.outcome)
    throw new Error("Repeat continuation was not selected.");
  if (
    record.implementationRound >=
    Math.min(group.maxIterations, record.snapshot.loop.policy.maxImplementationRounds)
  )
    return update(record, record.steps, "rejected");
  const advanced = advanceImplementationRound(record);
  return runRecordSchema.parse({
    ...advanced,
    revision: advanced.revision,
    steps: advanced.steps.map((step) =>
      group.stepIds.includes(step.stepId) || step.status === "skipped"
        ? {
            ...step,
            status: "pending",
            outcome: undefined,
            candidateId: undefined,
            inputHash: undefined,
          }
        : step,
    ),
  });
};

export const hashInputs = (candidateId: string, sourceIds: string[]): string =>
  createHash("sha256")
    .update(JSON.stringify([candidateId, [...sourceIds].sort()]))
    .digest("hex");

/** Reopen only the selected failure and results that consumed its output. */
export const prepareStepRetry = (
  record: RunRecord,
  stepId: string,
  expectedAttemptId: string,
): RunRecord => {
  const step = record.steps.find((item) => item.stepId === stepId);
  if (!step || !record.snapshot.loop.steps.some((item) => item.id === stepId))
    throw new Error("Unknown retry target.");
  if (record.status !== "failed" || step.status !== "failed")
    throw new Error("Only a failed step in a failed run can be retried.");
  if (record.steps.some((item) => isActiveStatus(item.status)))
    throw new Error("Active work must finish before retry.");
  if (step.attempts.at(-1)?.id !== expectedAttemptId)
    throw new Error("Retry target changed; reload the run.");
  if (!hasRetryBudget(record, step)) throw new Error("Attempt limit reached for this step.");
  const descendants = new Set(getDependentStepIds(record.snapshot.loop, stepId));
  const invalidated = record.steps.filter(
    (item) => descendants.has(item.stepId) && item.status !== "pending",
  );
  const sequence =
    Math.max(
      -1,
      ...record.evidence.filter((item) => item.kind === "event").map((item) => item.sequence),
    ) + 1;
  return runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    status: "running",
    steps: record.steps.map((item) =>
      item.stepId === stepId || descendants.has(item.stepId)
        ? {
            ...item,
            status: "pending",
            outcome: undefined,
            candidateId: undefined,
            inputHash: undefined,
          }
        : item,
    ),
    evidence: [
      ...record.evidence,
      {
        id: crypto.randomUUID(),
        runId: record.snapshot.id,
        stepId,
        attemptId: expectedAttemptId,
        createdAt: new Date().toISOString(),
        kind: "event",
        type: "lifecycle",
        title: "selected-step-retry",
        detail: `Attempt ${step.attempts.length + 1} starts from retained workspace and evidence. ${invalidated.length ? `Results needing revalidation: ${invalidated.map((item) => item.stepId).join(", ")}.` : "No completed downstream results need revalidation."}`,
        sequence,
      },
      ...invalidated.map((item, index) => ({
        id: crypto.randomUUID(),
        runId: record.snapshot.id,
        stepId: item.stepId,
        createdAt: new Date().toISOString(),
        kind: "event" as const,
        type: "lifecycle" as const,
        title: "retry-invalidated",
        detail: `Earlier ${item.stepId} results need revalidation after ${stepId} is retried.`,
        sequence: sequence + index + 1,
      })),
    ],
  });
};
