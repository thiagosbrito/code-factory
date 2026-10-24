import { runRecordSchema, type RunRecord } from "../domain/run.js";
import { usageReportSchema, type UsageReport } from "../domain/usage.js";

/**
 * Appends what a provider reported for an attempt. An attempt has at most one usage receipt, so a
 * repeated report is ignored (the first stands) and the record is returned unchanged.
 */
export const appendUsageReceipt = (
  record: RunRecord,
  stepId: string,
  attemptId: string,
  report: UsageReport,
): RunRecord => {
  if (record.evidence.some((item) => item.kind === "usage" && item.attemptId === attemptId))
    return record;
  const usage = usageReportSchema.parse(report);
  return runRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    evidence: [
      ...record.evidence,
      {
        id: crypto.randomUUID(),
        runId: record.snapshot.id,
        stepId,
        attemptId,
        createdAt: new Date().toISOString(),
        kind: "usage",
        ...usage,
      },
    ],
  });
};
