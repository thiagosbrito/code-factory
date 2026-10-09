import type { RunRecord } from "../../../domain/run.js";
import type { Evidence } from "../../../domain/evidence.js";
import type { EvidenceSummary } from "../../../domain/acceptance.js";
import { isIssueBlockedOutput } from "../../../domain/ticket.js";
import { SETUP_COMPLETED } from "../../../domain/run-branch.js";

export type RunStep = RunRecord["steps"][number];
export type StepDefinition = RunRecord["snapshot"]["loop"]["steps"][number];
export type RunScope = { kind: "run" } | { kind: "step"; stepId: string; attemptId: string | null };

export const runTitle = (run: RunRecord): string =>
  run.snapshot.task.ticket?.title ??
  run.snapshot.task.ticketId ??
  run.snapshot.task.description.slice(0, 80);

/** The failed step whose latest attempt reported that the agent could not read the issue. */
export const trackerConnectionStep = (run: RunRecord): RunStep | undefined => {
  const ticketId = run.snapshot.task.ticketId;
  // Cheap guards first: only failed agent-lookup runs need the evidence scan.
  if (run.status !== "failed" || !ticketId) return undefined;
  return run.steps.find(
    (step) =>
      step.status === "failed" &&
      run.evidence.some(
        (item) =>
          item.kind === "event" &&
          item.stepId === step.stepId &&
          item.attemptId === step.attempts.at(-1)?.id &&
          item.title === "completed" &&
          isIssueBlockedOutput(item.detail, ticketId),
      ),
  );
};

/** Callers that already computed the connection step pass it here to avoid a second scan. */
export const runStatusLabel = (run: RunRecord, connectionStep: RunStep | undefined): string =>
  connectionStep
    ? "Issue tracker connection needed"
    : run.status === "succeeded"
      ? "Completed"
      : run.status === "pending"
        ? "Pending"
        : (run.status[0] ?? "").toUpperCase() + run.status.slice(1);

export const runStatus = (run: RunRecord): string =>
  runStatusLabel(run, trackerConnectionStep(run));

const STOPPED = new Set(["blocked", "failed", "canceled", "rejected"]);
export const NOT_REACHED = "Not reached";

/** Derived only: a pending step of a stopped run reads "Not reached"; persisted state is unchanged. */
export const stepDisplayStatus = (run: RunRecord, step: RunStep | undefined): string => {
  const status = step?.status ?? "pending";
  return status === "pending" && STOPPED.has(run.status) ? NOT_REACHED : status;
};

export type RunStopCause = {
  kind: "setup" | "review-blocked" | "step-failed" | "canceled";
  stepId?: string;
  name: string;
  summary: string;
};

const latestEventDetail = (
  run: RunRecord,
  stepId: string,
  attemptId: string | undefined,
  titles: string[],
): string | undefined => {
  const event = [...run.evidence]
    .reverse()
    .find(
      (item) =>
        item.kind === "event" &&
        item.stepId === stepId &&
        item.attemptId === attemptId &&
        titles.includes(item.title),
    );
  return event?.kind === "event" ? event.detail : undefined;
};

/** Names what stopped a blocked, failed or canceled run. A tracker-connection banner wins. */
export const runStopCause = (run: RunRecord): RunStopCause | undefined => {
  if (trackerConnectionStep(run)) return undefined;
  const nameOf = (stepId: string) =>
    run.snapshot.loop.steps.find((item) => item.id === stepId)?.name || stepId;
  if (run.status === "blocked") {
    const step = run.steps.find(
      (item) =>
        item.status === "succeeded" &&
        item.outcome === "blocked" &&
        run.snapshot.loop.steps.find((d) => d.id === item.stepId)?.stage === "review",
    );
    if (!step) return undefined;
    const attemptId = step.attempts.at(-1)?.id;
    const review = [...run.evidence]
      .reverse()
      .find(
        (item) =>
          item.kind === "review" && item.attemptId === attemptId && item.verdict === "blocked",
      );
    const findings = review?.kind === "review" ? review.findings.join("\n") : "";
    return {
      kind: "review-blocked",
      stepId: step.stepId,
      name: nameOf(step.stepId),
      summary: findings || latestEventDetail(run, step.stepId, attemptId, ["completed"]) || "",
    };
  }
  if (run.status !== "failed" && run.status !== "canceled") return undefined;
  const setup = [...run.evidence]
    .reverse()
    .find(
      (item) =>
        item.kind === "event" &&
        !item.stepId &&
        item.title === SETUP_COMPLETED &&
        (item.state === "failed" || item.state === "canceled"),
    );
  if (setup?.kind === "event")
    return { kind: "setup", name: "Setup command", summary: setup.detail ?? "" };
  const step = run.steps.find((item) => item.attempts.at(-1)?.status === "failed");
  if (step) {
    const attemptId = step.attempts.at(-1)?.id;
    return {
      kind: "step-failed",
      stepId: step.stepId,
      name: nameOf(step.stepId),
      summary: // The latest of these explains the failure: Code Factory's own reasons are recorded
        // after the agent's completion, so they win over an agent that reported success.
        (
          latestEventDetail(run, step.stepId, attemptId, [
            "commit-failed",
            "completed",
            "Check completed",
            "execution-interrupted",
            "result-rejected",
            "read-only-violation",
            "checkout-moved",
          ]) ?? ""
        ).slice(0, 600),
    };
  }
  return run.status === "canceled"
    ? { kind: "canceled", name: "Run", summary: "The run was canceled." }
    : undefined;
};

export const scopeEvidence = (run: RunRecord, scope: RunScope): Evidence[] =>
  run.evidence.filter((item) =>
    scope.kind === "run"
      ? true
      : item.stepId === scope.stepId &&
        (scope.attemptId === null || item.attemptId === scope.attemptId),
  );

/** Append-only invalidation events supersede older receipts without rewriting history. */
export const evidenceFreshness = (run: RunRecord, receipt: Evidence): string => {
  if (!("freshness" in receipt)) return "unknown";
  const position = run.evidence.findIndex((item) => item.id === receipt.id);
  const invalidated = run.evidence
    .slice(position + 1)
    .some(
      (item) =>
        item.kind === "event" &&
        item.title === "retry-invalidated" &&
        item.stepId === receipt.stepId,
    );
  return invalidated ? "superseded · needs revalidation" : receipt.freshness.state;
};

export const acceptanceFreshness = (
  receipt: Extract<Evidence, { kind: "acceptance" }>,
  summary: EvidenceSummary | null,
): string => {
  if (!summary) return "unverified · current validation unavailable";
  return summary.acceptance === "accepted" && summary.signature === receipt.validationSignature
    ? "current"
    : "invalidated · current validation inputs changed";
};

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
