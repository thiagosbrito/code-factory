import type { RunRecord } from "./run.js";
import { z } from "zod";
import { artifactSchema, fileChangeSchema } from "./evidence.js";

type Receipt = RunRecord["evidence"][number];
type ValidationReceipt = Extract<Receipt, { kind: "check" | "review" }>;

export type EvidenceRequirement = {
  stepId: string;
  name: string;
  state: "met" | "gap" | "not-required";
  reason: string;
  receiptId?: string | undefined;
};

export type EvidenceSummary = {
  validation: "passed" | "incomplete";
  acceptance: "accepted" | "invalidated" | "pending";
  requirements: EvidenceRequirement[];
  findings: string[];
  gaps: string[];
  files: Extract<Receipt, { kind: "file" }>[];
  artifacts: Extract<Receipt, { kind: "artifact" }>[];
  signature: string | null;
  acceptedAt?: string | undefined;
};

export const evidenceSummarySchema = z.object({
  validation: z.enum(["passed", "incomplete"]),
  acceptance: z.enum(["accepted", "invalidated", "pending"]),
  requirements: z.array(
    z.object({
      stepId: z.string(),
      name: z.string(),
      state: z.enum(["met", "gap", "not-required"]),
      reason: z.string(),
      receiptId: z.string().optional(),
    }),
  ),
  findings: z.array(z.string()),
  gaps: z.array(z.string()),
  files: z.array(fileChangeSchema),
  artifacts: z.array(artifactSchema),
  signature: z.string().nullable(),
  acceptedAt: z.string().optional(),
});

const currentReceipt = (
  run: RunRecord,
  stepId: string,
  candidateId: string | null,
): { receipt?: ValidationReceipt; reason: string } => {
  const definition = run.snapshot.loop.steps.find((item) => item.id === stepId);
  const expectedKind = definition?.kind === "check" ? "check" : "review";
  const step = run.steps.find((item) => item.stepId === stepId);
  const attempt = step?.attempts.at(-1);
  const receipt = run.evidence
    .slice()
    .reverse()
    .find(
      (item): item is ValidationReceipt =>
        item.kind === expectedKind && item.stepId === stepId && item.attemptId === attempt?.id,
    );
  if (!step || !attempt || step.status !== "succeeded" || attempt.status !== "succeeded")
    return { reason: "Latest step attempt has not succeeded." };
  if (!receipt) return { reason: "No validation receipt for the latest attempt." };
  if (attempt.implementationRound !== run.implementationRound)
    return { reason: "Receipt belongs to an earlier implementation round." };
  if (receipt.freshness.state !== "current")
    return { reason: receipt.freshness.reason ?? "Receipt was superseded." };
  if (receipt.provenance.baselineId !== run.snapshot.baseline.id)
    return { reason: "Receipt uses a different source baseline." };
  if (
    receipt.provenance.candidateId !== step.candidateId ||
    receipt.provenance.candidateId !== candidateId
  )
    return { reason: "Source candidate changed after validation." };
  if (!receipt.inputHash || receipt.inputHash !== step.inputHash)
    return { reason: "Task or dependency input hash changed or was not recorded." };
  const validInputs = receipt.provenance.inputReceiptIds.every((id) => {
    const input = run.evidence.find((item) => item.id === id);
    if (!input || (input.kind !== "check" && input.kind !== "review" && input.kind !== "output"))
      return false;
    const inputStep = run.steps.find((item) => item.stepId === input.stepId);
    return (
      input.freshness.state === "current" &&
      inputStep?.attempts.at(-1)?.id === input.attemptId &&
      inputStep.status === "succeeded"
    );
  });
  if (!validInputs) return { reason: "A validation input receipt is missing or superseded." };
  if (receipt.kind === "check" && receipt.outcome !== "passed")
    return { reason: `Check ${receipt.outcome}.` };
  if (receipt.kind === "review" && receipt.verdict !== "pass")
    return { reason: `Review ${receipt.verdict}.` };
  return { receipt, reason: "Passed against the current attempt and inputs." };
};

export const summarizeEvidence = (run: RunRecord, candidateId: string | null): EvidenceSummary => {
  const requirements = run.snapshot.loop.steps
    .filter((step) => step.kind === "check" || step.stage === "review")
    .map((definition): EvidenceRequirement => {
      const step = run.steps.find((item) => item.stepId === definition.id);
      if (step?.status === "skipped")
        return {
          stepId: definition.id,
          name: definition.name,
          state: "not-required",
          reason: "Skipped by this loop path.",
        };
      const { receipt, reason } = currentReceipt(run, definition.id, candidateId);
      return {
        stepId: definition.id,
        name: definition.name,
        state: receipt ? "met" : "gap",
        reason,
        receiptId: receipt?.id,
      };
    });
  const gaps = requirements
    .filter((item) => item.state === "gap")
    .map((item) => `${item.name}: ${item.reason}`);
  if (requirements.length === 0) gaps.unshift("Loop has no validation checks or reviews.");
  if (run.status !== "succeeded") gaps.unshift("Run has not succeeded.");
  if (!candidateId) gaps.unshift("Current source candidate is unavailable.");
  const findings = run.evidence
    .filter(
      (item): item is Extract<Receipt, { kind: "review" }> =>
        item.kind === "review" &&
        run.steps.some(
          (step) => step.stepId === item.stepId && step.attempts.at(-1)?.id === item.attemptId,
        ),
    )
    .flatMap((item) => item.findings);
  const latest = (item: Extract<Receipt, { kind: "file" | "artifact" }>) =>
    run.steps.some(
      (step) => step.stepId === item.stepId && step.attempts.at(-1)?.id === item.attemptId,
    );
  const files = run.evidence.filter(
    (item): item is Extract<Receipt, { kind: "file" }> => item.kind === "file" && latest(item),
  );
  const artifacts = run.evidence.filter(
    (item): item is Extract<Receipt, { kind: "artifact" }> =>
      item.kind === "artifact" && latest(item),
  );
  const signature =
    gaps.length === 0
      ? JSON.stringify({
          task: run.snapshot.task,
          loop: [run.snapshot.loop.id, run.snapshot.loop.version],
          baseline: run.snapshot.baseline.id,
          candidateId,
          round: run.implementationRound,
          receipts: requirements
            .filter((item) => item.state === "met")
            .map((item) => item.receiptId),
        })
      : null;
  const acceptances = run.evidence.filter(
    (item): item is Extract<Receipt, { kind: "acceptance" }> => item.kind === "acceptance",
  );
  const accepted = signature
    ? acceptances
        .slice()
        .reverse()
        .find(
          (item) =>
            item.validationSignature === signature && item.provenance.candidateId === candidateId,
        )
    : undefined;
  return {
    validation: signature ? "passed" : "incomplete",
    acceptance: accepted ? "accepted" : acceptances.length ? "invalidated" : "pending",
    requirements,
    findings,
    gaps,
    files,
    artifacts,
    signature,
    acceptedAt: accepted?.createdAt,
  };
};

export const acceptEvidence = (run: RunRecord, candidateId: string): RunRecord => {
  const summary = summarizeEvidence(run, candidateId);
  if (!summary.signature) throw new Error("Current validation evidence is incomplete.");
  if (summary.acceptance === "accepted") return run;
  return {
    ...run,
    revision: run.revision + 1,
    evidence: [
      ...run.evidence,
      {
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        createdAt: new Date().toISOString(),
        kind: "acceptance",
        validationSignature: summary.signature,
        provenance: {
          source: "human",
          baselineId: run.snapshot.baseline.id,
          candidateId,
          inputReceiptIds: summary.requirements.flatMap((item) =>
            item.receiptId ? [item.receiptId] : [],
          ),
        },
        freshness: { state: "current", checkedAgainstCandidateId: candidateId },
      },
    ],
  };
};
