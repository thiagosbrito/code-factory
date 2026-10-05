import { z } from "zod";
import type { AgentAdapter } from "../adapters/contract.js";
import { runRecordSchema, type RunRecord } from "../domain/run.js";
import { mutateRun, readRun } from "./storage.js";
import { ProjectError } from "./project.js";

type Guidance = Extract<RunRecord["evidence"][number], { kind: "guidance" }>;
const isGuidance = (item: RunRecord["evidence"][number]): item is Guidance =>
  item.kind === "guidance";
const deliveries = new Map<string, Promise<RunRecord>>();

export const guidanceInputSchema = z.strictObject({
  stepId: z.string().min(1),
  attemptId: z.uuid(),
  message: z.string().trim().min(1).max(10000),
});
export type GuidanceInput = z.infer<typeof guidanceInputSchema>;

const append = (
  record: RunRecord,
  entry: Omit<
    Extract<RunRecord["evidence"][number], { kind: "guidance" }>,
    "id" | "createdAt" | "runId"
  >,
  bumpRevision = true,
): RunRecord =>
  runRecordSchema.parse({
    ...record,
    revision: record.revision + (bumpRevision ? 1 : 0),
    evidence: [
      ...record.evidence,
      {
        ...entry,
        id: crypto.randomUUID(),
        runId: record.snapshot.id,
        createdAt: new Date().toISOString(),
      },
    ],
  });

export const sendGuidance = async (
  project: string,
  runId: string,
  input: GuidanceInput,
  adapter: AgentAdapter | null,
): Promise<RunRecord> => {
  const messageId = crypto.randomUUID();
  let queued = await mutateRun(project, runId, (record) => {
    const step = record.steps.find((item) => item.stepId === input.stepId);
    const attempt = step?.attempts.find((item) => item.id === input.attemptId);
    if (!attempt) throw new ProjectError("The selected attempt does not belong to this step.", 404);
    const terminal = attempt.status !== "running";
    if (!terminal && !adapter)
      throw new ProjectError(
        "Verified agent connection unavailable; guidance was not queued.",
        503,
      );
    if (!terminal && adapter?.capabilities.steering !== "supported")
      throw new ProjectError(
        `Steering is ${adapter?.capabilities.steering ?? "unknown"} for this connection; guidance was not queued.`,
        422,
      );
    return append(record, {
      kind: "guidance",
      stepId: input.stepId,
      attemptId: input.attemptId,
      messageId,
      message: input.message,
      state: terminal ? "rejected" : "queued",
      ...(terminal
        ? { reason: `Attempt ${attempt.number} is ${attempt.status}; guidance was not delivered.` }
        : {}),
    });
  });
  return deliverQueuedGuidance(project, queued, input.stepId, input.attemptId, adapter);
};

export const deliverQueuedGuidance = async (
  project: string,
  queued: RunRecord,
  stepId: string,
  attemptId: string,
  adapter: AgentAdapter | null,
): Promise<RunRecord> => {
  const pending = queued.evidence
    .filter(isGuidance)
    .filter(
      (item) =>
        item.stepId === stepId &&
        item.attemptId === attemptId &&
        item.state === "queued" &&
        !queued.evidence.some(
          (later) =>
            later.kind === "guidance" && later.messageId === item.messageId && later.id !== item.id,
        ),
    );
  for (const guidance of pending) queued = await deliverOne(project, queued, guidance, adapter);
  return queued;
};

const deliverOne = async (
  project: string,
  queued: RunRecord,
  guidance: Guidance,
  adapter: AgentAdapter | null,
): Promise<RunRecord> => {
  const key = `${project}:${queued.snapshot.id}:${guidance.messageId}`;
  const active = deliveries.get(key);
  if (active) return active;
  const work = deliverOneOnce(project, queued, guidance, adapter);
  deliveries.set(key, work);
  try {
    return await work;
  } finally {
    if (deliveries.get(key) === work) deliveries.delete(key);
  }
};

const deliverOneOnce = async (
  project: string,
  queued: RunRecord,
  guidance: Guidance,
  adapter: AgentAdapter | null,
): Promise<RunRecord> => {
  const input = guidance;
  const messageId = guidance.messageId;
  const runId = queued.snapshot.id;
  const current = await readRun(project, runId);
  if (current) queued = current;
  if (
    queued.evidence.some(
      (item) => item.kind === "guidance" && item.messageId === messageId && item.id !== guidance.id,
    )
  )
    return queued;
  const stepId = input.stepId;
  const attemptId = input.attemptId;
  const step = queued.steps.find((item) => item.stepId === stepId);
  const attempt = step?.attempts.find((item) => item.id === attemptId);
  if (
    !attempt ||
    attempt.status !== "running" ||
    !attempt.sessionId ||
    !attempt.turnId ||
    queued.status !== "running" ||
    adapter?.capabilities.steering !== "supported"
  )
    return queued;
  try {
    const result = await adapter.steer(
      {
        runId,
        stepId,
        attempt: attempt.number,
        sessionId: attempt.sessionId,
        turnId: attempt.turnId,
      },
      `${input.message}\n\nWhen you respond to this guidance, include GUIDANCE-ACK:${messageId} in your reply.`,
    );
    queued = await mutateRun(project, runId, (record) => {
      let next = append(record, {
        kind: "guidance",
        stepId,
        attemptId,
        messageId,
        message: input.message,
        state: result === "supported" ? "delivered" : "rejected",
        ...(result !== "supported" ? { reason: `Adapter reported ${result} steering.` } : {}),
      });
      if (result === "supported") {
        for (const event of next.evidence) {
          if (event.kind === "event" && event.type === "message" && event.attemptId === attemptId)
            next = acknowledgeGuidance(next, stepId, attemptId, event.id);
        }
      }
      return next;
    });
  } catch (error) {
    queued = await mutateRun(project, runId, (record) =>
      append(record, {
        kind: "guidance",
        stepId,
        attemptId,
        messageId,
        message: input.message,
        state: "rejected",
        reason: error instanceof Error ? `Delivery failed: ${error.message}` : "Delivery failed.",
      }),
    );
  }
  return queued;
};

export const acknowledgeGuidance = (
  record: RunRecord,
  stepId: string,
  attemptId: string,
  replyEventId: string,
): RunRecord => {
  const messages = record.evidence.filter(
    (item) => item.kind === "event" && item.type === "message" && item.attemptId === attemptId,
  );
  const reply = messages.find((item) => item.id === replyEventId);
  if (!reply || reply.kind !== "event") return record;
  const replyIndex = record.evidence.findIndex((item) => item.id === replyEventId);
  const delivered = record.evidence
    .filter(isGuidance)
    .filter(
      (item) =>
        item.stepId === stepId && item.attemptId === attemptId && item.state === "delivered",
    );
  let next = record;
  for (const guidance of delivered) {
    const queuedIndex = record.evidence.findIndex(
      (item) =>
        item.kind === "guidance" &&
        item.messageId === guidance.messageId &&
        item.state === "queued",
    );
    const response = record.evidence
      .slice(queuedIndex + 1, replyIndex + 1)
      .filter(
        (item) => item.kind === "event" && item.type === "message" && item.attemptId === attemptId,
      )
      .map((item) => (item.kind === "event" ? (item.detail ?? "") : ""))
      .join("");
    if (
      queuedIndex < 0 ||
      queuedIndex >= replyIndex ||
      !response.includes(`GUIDANCE-ACK:${guidance.messageId}`) ||
      record.evidence.some(
        (item) =>
          item.kind === "guidance" &&
          item.messageId === guidance.messageId &&
          item.state === "acknowledged",
      )
    )
      continue;
    next = append(
      next,
      {
        kind: "guidance",
        stepId,
        attemptId,
        messageId: guidance.messageId,
        message: guidance.message,
        state: "acknowledged",
        acknowledgedAt: reply.createdAt,
        replyEventId,
      },
      false,
    );
  }
  return next;
};

export const expireQueuedGuidance = (
  record: RunRecord,
  stepId: string,
  attemptId: string,
): RunRecord => {
  const attempt = record.steps
    .find((item) => item.stepId === stepId)
    ?.attempts.find((item) => item.id === attemptId);
  if (!attempt || attempt.status === "running") return record;
  let next = record;
  const pending = record.evidence
    .filter(isGuidance)
    .filter(
      (item) =>
        item.stepId === stepId &&
        item.attemptId === attemptId &&
        item.state === "queued" &&
        !record.evidence.some(
          (later) =>
            later.kind === "guidance" && later.messageId === item.messageId && later.id !== item.id,
        ),
    );
  for (const [index, item] of pending.entries())
    next = append(
      next,
      {
        kind: "guidance",
        stepId,
        attemptId,
        messageId: item.messageId,
        message: item.message,
        state: "rejected",
        reason: `Attempt ${attempt.number} ${attempt.status} before delivery.`,
      },
      index === 0,
    );
  return next;
};
