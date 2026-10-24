import { describe, expect, it } from "vitest";
import { evidenceSchema } from "../src/domain/evidence.js";
import { finishAttempt, runRecordSchema, startAttempt, type RunRecord } from "../src/domain/run.js";
import { summarizeUsage, usageReportSchema } from "../src/domain/usage.js";
import { run } from "./support/scheduler.js";

const attempted = (times = 1): RunRecord => {
  let record = run({ policy: { maxAttemptsPerStep: 3, maxImplementationRounds: 2 } });
  for (let index = 0; index < times; index += 1) {
    record = startAttempt(record, "build");
    if (index < times - 1) record = finishAttempt(record, "build", "failed");
  }
  return record;
};
const receipt = (record: RunRecord, attemptIndex: number, usage: object) => ({
  id: crypto.randomUUID(),
  runId: record.snapshot.id,
  stepId: "build",
  attemptId: record.steps[0]?.attempts[attemptIndex]?.id,
  createdAt: new Date().toISOString(),
  kind: "usage" as const,
  ...usage,
});
const withReceipts = (record: RunRecord, ...items: object[]): RunRecord =>
  runRecordSchema.parse({ ...record, evidence: [...record.evidence, ...items] });
const estimate = (amount: number) => ({
  amount,
  currency: "USD" as const,
  source: "provider-estimate" as const,
});

describe("usage report schema", () => {
  it("keeps reported zeros and rejects an empty report", () => {
    expect(usageReportSchema.parse({ tokens: { input: 0 } })).toEqual({ tokens: { input: 0 } });
    expect(usageReportSchema.parse({ cost: estimate(0) }).cost?.amount).toBe(0);
    expect(usageReportSchema.safeParse({}).success).toBe(false);
    expect(usageReportSchema.safeParse({ tokens: {} }).success).toBe(false);
  });
  it("rejects negative, fractional and non-finite values", () => {
    for (const tokens of [{ input: -1 }, { output: 1.5 }, { input: Number.NaN }])
      expect(usageReportSchema.safeParse({ tokens }).success).toBe(false);
    expect(usageReportSchema.safeParse({ cost: estimate(-0.1) }).success).toBe(false);
  });
});

describe("usage receipts in a run record", () => {
  it("loads a record that has no usage receipt", () => {
    expect(runRecordSchema.parse(run()).evidence).toEqual([]);
  });
  it("accepts one receipt per attempt and rejects a second for the same attempt", () => {
    const record = attempted();
    const first = receipt(record, 0, { tokens: { input: 5 } });
    expect(() => withReceipts(record, first)).not.toThrow();
    expect(() => withReceipts(record, first, receipt(record, 0, { tokens: { input: 6 } }))).toThrow(
      /more than one usage receipt/i,
    );
  });
  it("rejects a receipt for a missing attempt or without an attempt", () => {
    const record = attempted();
    expect(() =>
      withReceipts(record, {
        ...receipt(record, 0, { tokens: { input: 1 } }),
        attemptId: crypto.randomUUID(),
      }),
    ).toThrow(/missing attempt/i);
    expect(
      evidenceSchema.safeParse({
        ...receipt(record, 0, { tokens: { input: 1 } }),
        attemptId: undefined,
      }).success,
    ).toBe(false);
  });
});

describe("summarizeUsage", () => {
  it("is not reported when no attempt reported", () => {
    expect(summarizeUsage(attempted(2))).toMatchObject({
      attempts: 2,
      reported: 0,
      partial: true,
      tokens: null,
      cost: null,
    });
  });
  it("is empty without attempts", () => {
    expect(summarizeUsage(run())).toMatchObject({ attempts: 0, reported: 0, partial: false });
  });
  it("sums attempts without double counting and flags a partial total", () => {
    const record = attempted(3);
    const two = withReceipts(
      record,
      receipt(record, 0, { tokens: { input: 10, output: 5 }, cost: estimate(0.25) }),
      receipt(record, 1, { tokens: { input: 1, output: 0, cacheRead: 7 } }),
    );
    const summary = summarizeUsage(two);
    expect(summary.attempts).toBe(3);
    expect(summary.reported).toBe(2);
    expect(summary.partial).toBe(true);
    expect(summary.tokens).toEqual({ input: 11, output: 5, cacheRead: 7, cacheWrite: null });
    expect(summary.cost).toEqual(estimate(0.25));
    const all = withReceipts(two, receipt(record, 2, { tokens: { input: 2 } }));
    expect(summarizeUsage(all)).toMatchObject({ reported: 3, partial: false });
  });
  it("keeps a reported zero distinct from not reported", () => {
    const record = attempted();
    const summary = summarizeUsage(
      withReceipts(record, receipt(record, 0, { tokens: { output: 0 } })),
    );
    expect(summary.tokens).toEqual({ input: null, output: 0, cacheRead: null, cacheWrite: null });
  });
  it("scopes to one step", () => {
    const record = attempted();
    const full = withReceipts(record, receipt(record, 0, { tokens: { input: 3 } }));
    expect(summarizeUsage(full, "quality")).toMatchObject({ attempts: 0, reported: 0 });
    expect(summarizeUsage(full, "build").tokens?.input).toBe(3);
  });
});
