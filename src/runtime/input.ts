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
  const run = await readRun(project, runId);
  if (!run) throw new ProjectError("Run not found.", 404);
  const request = pendingRequest(run, input);
  const attempt = run.steps.find((item) => item.stepId === input.stepId)?.attempts.at(-1);
  if (!attempt) throw new ProjectError("Attempt not found.", 409);
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
  const replied = await mutateRun(project, runId, (current) => {
    const stillWaiting =
      current.steps.find((item) => item.stepId === input.stepId)?.attempts.at(-1)?.status ===
      "waiting-input";
    const next = stillWaiting
      ? setAttemptControlState(current, input.stepId, input.attemptId, "running")
      : current;
    return runRecordSchema.parse({
      ...next,
      revision: stillWaiting ? next.revision : current.revision + 1,
      evidence: [
        ...next.evidence,
        {
          id: crypto.randomUUID(),
          runId,
          stepId: input.stepId,
          attemptId: input.attemptId,
          createdAt: new Date().toISOString(),
          kind: "input-reply",
          requestEvidenceId: request.id,
          answers: input.answers,
          state: "sent",
        },
      ],
    });
  });
  return deliverQueuedGuidance(project, replied, input.stepId, input.attemptId, adapter);
};
