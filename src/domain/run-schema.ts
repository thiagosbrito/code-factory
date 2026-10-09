import { z } from "zod";
import { evidenceSchema } from "./evidence.js";
import { runSnapshotSchema } from "./run-snapshot.js";

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

export const baseRunRecordSchema = z.strictObject({
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
  promotion: z
    .strictObject({
      branch: z.string().min(1).max(255),
      commit: z.string().regex(/^[0-9a-f]{40,64}$/),
      createdAt: z.iso.datetime(),
    })
    .optional(),
  worktree: z.strictObject({ removedAt: z.iso.datetime() }).optional(),
});

export type RunRecordShape = z.infer<typeof baseRunRecordSchema>;

export type StepRun = RunRecordShape["steps"][number];

export type Attempt = StepRun["attempts"][number];

export type Receipt = RunRecordShape["evidence"][number];

export type Report = (message: string) => void;
