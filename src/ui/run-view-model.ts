import type { RunRecord } from "../domain/run.js";
import type { Evidence } from "../domain/evidence.js";

export type RunStep = RunRecord["steps"][number];
export type StepDefinition = RunRecord["snapshot"]["loop"]["steps"][number];
export type RunScope = { kind: "run" } | { kind: "step"; stepId: string; attemptId: string | null };

export const runTitle = (run: RunRecord): string =>
  run.snapshot.task.ticket?.title ?? run.snapshot.task.description.slice(0, 80);

export const runStatus = (run: RunRecord): string =>
  run.status === "succeeded"
    ? "Completed"
    : run.status === "pending"
      ? "Pending"
      : (run.status[0] ?? "").toUpperCase() + run.status.slice(1);

export const scopeEvidence = (run: RunRecord, scope: RunScope): Evidence[] =>
  run.evidence.filter((item) =>
    scope.kind === "run"
      ? true
      : item.stepId === scope.stepId &&
        (scope.attemptId === null || item.attemptId === scope.attemptId),
  );

export const stepForScope = (run: RunRecord, scope: RunScope): RunStep | undefined =>
  scope.kind === "step" ? run.steps.find((item) => item.stepId === scope.stepId) : undefined;

export const definitionForScope = (run: RunRecord, scope: RunScope): StepDefinition | undefined =>
  scope.kind === "step"
    ? run.snapshot.loop.steps.find((item) => item.id === scope.stepId)
    : undefined;

export const validScope = (run: RunRecord, scope: RunScope): RunScope => {
  if (scope.kind === "run") return scope;
  const step = stepForScope(run, scope);
  if (!step) return { kind: "run" };
  if (scope.attemptId && !step.attempts.some((item) => item.id === scope.attemptId))
    return { kind: "step", stepId: scope.stepId, attemptId: step.attempts.at(-1)?.id ?? null };
  return scope;
};
