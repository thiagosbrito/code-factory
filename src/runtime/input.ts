import { z } from "zod";
import type { AgentAdapter } from "../adapters/contract.js";
import { runRecordSchema, setAttemptControlState, type RunRecord } from "../domain/run.js";
import { ProjectError } from "./project.js";
import { deliverQueuedGuidance } from "./guidance.js";
import { mutateRun, readRun } from "./storage.js";

export const inputReplySchema = z.strictObject({
  stepId: z.string().min(1),
  attemptId: z.uuid(),
  requestEvidenceId: z.uuid(),
  answers: z.record(
    z.string(),
    z.strictObject({ answers: z.array(z.string().trim().min(1)).min(1) }),
  ),
});
export type InputReply = z.infer<typeof inputReplySchema>;

type Request = Extract<RunRecord["evidence"][number], { kind: "input-request" }>;
type ReplyState = "sending" | "sent" | "uncertain";

const withReplyEvidence = (
  run: RunRecord,
  input: InputReply,
  state: ReplyState,
  reason?: string,
): RunRecord =>
  runRecordSchema.parse({
    ...run,
    revision: run.revision + 1,
    evidence: [
      ...run.evidence,
      {
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: input.stepId,
        attemptId: input.attemptId,
        createdAt: new Date().toISOString(),
        kind: "input-reply",
        requestEvidenceId: input.requestEvidenceId,
        answers: input.answers,
        state,
        ...(reason ? { reason } : {}),
      },
    ],
  });

const pendingRequest = (run: RunRecord, input: InputReply): Request => {
  const step = run.steps.find((item) => item.stepId === input.stepId);
  const attempt = step?.attempts.at(-1);
  const request = run.evidence.find((item) => item.id === input.requestEvidenceId);
  if (
    attempt?.id !== input.attemptId ||
    attempt.status !== "waiting-input" ||
    request?.kind !== "input-request" ||
    request.stepId !== input.stepId ||
    request.attemptId !== input.attemptId ||
    request.sessionId !== attempt.sessionId ||
    request.turnId !== attempt.turnId ||
    run.evidence.some(
      (item) => item.kind === "input-reply" && item.requestEvidenceId === request.id,
    )
  )
    throw new ProjectError("This native input request is no longer pending.", 409);
  const latest = [...run.evidence]
    .reverse()
    .find((item) => item.kind === "input-request" && item.attemptId === input.attemptId);
  if (latest?.id !== request.id)
    throw new ProjectError("A newer input request replaced this one.", 409);
  const expected = new Set(request.questions.map((question) => question.id));
  if (
    Object.keys(input.answers).length !== expected.size ||
    Object.keys(input.answers).some((id) => !expected.has(id))
  )
    throw new ProjectError("Answer each question in this request exactly once.", 400);
  return request;
};

export const replyToInput = async (
  project: string,
  runId: string,
  input: InputReply,
  adapter: AgentAdapter | null,
): Promise<RunRecord> => {
  if (adapter?.capabilities.waitingInput !== "supported" || !adapter.replyToInput)
    throw new ProjectError("Native input replies are unavailable for this provider.", 422);
  if (!(await readRun(project, runId))) throw new ProjectError("Run not found.", 404);
  // Persist intent before the native process can consume the answer. A crash
  // after this point leaves a visible, uncertain delivery instead of no trace.
  const prepared = await mutateRun(project, runId, (current) => {
    pendingRequest(current, input);
    return withReplyEvidence(current, input, "sending");
  });
  const request = prepared.evidence.find(
    (item): item is Request => item.id === input.requestEvidenceId && item.kind === "input-request",
  );
  const attempt = prepared.steps.find((item) => item.stepId === input.stepId)?.attempts.at(-1);
  if (!request || !attempt)
    throw new ProjectError("This native input request is no longer pending.", 409);
  try {
    await adapter.replyToInput(
      {
        runId,
        stepId: input.stepId,
        attempt: attempt.number,
        sessionId: request.sessionId,
        turnId: request.turnId,
      },
      request.requestId,
      input.answers,
    );
  } catch (error) {
    await mutateRun(project, runId, (current) =>
      withReplyEvidence(
        current,
        input,
        "uncertain",
        error instanceof Error ? error.message : "Native reply failed.",
      ),
    );
    throw new ProjectError(
      "Native reply delivery could not be confirmed. Cancel and retry the attempt.",
      409,
    );
  }
  const replied = await mutateRun(project, runId, (current) => {
    const stillWaiting =
      current.steps.find((item) => item.stepId === input.stepId)?.attempts.at(-1)?.status ===
      "waiting-input";
    const next = stillWaiting
      ? setAttemptControlState(current, input.stepId, input.attemptId, "running")
      : current;
    const sent = withReplyEvidence(next, input, "sent");
    return stillWaiting ? runRecordSchema.parse({ ...sent, revision: next.revision }) : sent;
  });
  return deliverQueuedGuidance(project, replied, input.stepId, input.attemptId, adapter);
};
