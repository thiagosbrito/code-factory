import { z } from "zod";
import { type RunSnapshot } from "./run-snapshot.js";
import { baseRunRecordSchema, type Report } from "./run-schema.js";
import {
  validateRoundHistory,
  validateSteps,
  validateBindings,
  validateEvidence,
} from "./run-validation.js";

export const runRecordSchema = baseRunRecordSchema.superRefine((record, context) => {
  const report: Report = (message) => context.addIssue({ code: "custom", message });
  if (record.snapshot.loop.status !== "published") report("Run loop must be published.");
  validateRoundHistory(record, report);
  validateSteps(record, report);
  validateBindings(record, report);
  validateEvidence(record, report);
});

export type RunRecord = z.infer<typeof runRecordSchema>;

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
