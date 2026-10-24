import { z } from "zod";
import type { RunRecordShape } from "./run-schema.js";

const tokenCount = z.number().int().nonnegative();

/** Token counts a provider reported. An absent field was not reported; it is never defaulted to 0. */
export const usageTokensSchema = z
  .strictObject({
    input: tokenCount.optional(),
    output: tokenCount.optional(),
    cacheRead: tokenCount.optional(),
    cacheWrite: tokenCount.optional(),
  })
  .refine((tokens) => Object.values(tokens).some((value) => value !== undefined), {
    message: "Usage tokens must report at least one count.",
  });

/** A monetary amount and where it came from; a provider estimate is never presented as billing. */
export const usageCostSchema = z.strictObject({
  amount: z.number().finite().nonnegative(),
  currency: z.literal("USD"),
  source: z.enum(["provider-estimate", "provider-reported"]),
});

export const usageFields = {
  tokens: usageTokensSchema.optional(),
  cost: usageCostSchema.optional(),
  /** A caveat the provider's own numbers carry, for example what the token counts leave out. */
  note: z.string().min(1).max(300).optional(),
};

/** What an adapter reports for one attempt; provider-neutral and entirely optional per field. */
export const usageReportSchema = z
  .strictObject(usageFields)
  .refine((report) => report.tokens !== undefined || report.cost !== undefined, {
    message: "A usage report needs tokens or a cost.",
  });

export type UsageReport = z.infer<typeof usageReportSchema>;
export type UsageCost = z.infer<typeof usageCostSchema>;

export const TOKEN_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;
export type TokenKey = (typeof TOKEN_KEYS)[number];

export interface UsageSummary {
  /** Attempts in scope, whether or not they reported. */
  attempts: number;
  /** Attempts that have a usage receipt. */
  reported: number;
  /** True when some attempt in scope has no receipt, so the totals undercount. */
  partial: boolean;
  /** Each count summed over the reports that carry it; null when no report carried it. */
  tokens: Record<TokenKey, number | null> | null;
  cost: UsageCost | null;
  notes: string[];
}

/**
 * Totals the usage receipts of a run, of one step, or of one attempt. Each attempt has at most one receipt, so a
 * retry adds its own spend and nothing is counted twice. A field no attempt reported stays null.
 */
export const summarizeUsage = (
  record: RunRecordShape,
  stepId?: string,
  attemptId?: string,
): UsageSummary => {
  const attemptIds = new Set(
    record.steps
      .filter((step) => stepId === undefined || step.stepId === stepId)
      .flatMap((step) => step.attempts)
      .filter((attempt) => attemptId === undefined || attempt.id === attemptId)
      .map((attempt) => attempt.id),
  );
  const receipts = record.evidence.flatMap((item) =>
    item.kind === "usage" && attemptIds.has(item.attemptId) ? [item] : [],
  );
  const total = (key: TokenKey): number | null =>
    receipts.reduce<number | null>((sum, item) => {
      const value = item.tokens?.[key];
      return value === undefined ? sum : (sum ?? 0) + value;
    }, null);
  const costs = receipts.flatMap((item) => (item.cost ? [item.cost] : []));
  const tokens = {
    input: total("input"),
    output: total("output"),
    cacheRead: total("cacheRead"),
    cacheWrite: total("cacheWrite"),
  };
  return {
    attempts: attemptIds.size,
    reported: receipts.length,
    partial: receipts.length < attemptIds.size,
    tokens: TOKEN_KEYS.some((key) => tokens[key] !== null) ? tokens : null,
    cost: costs.length
      ? {
          amount: costs.reduce((sum, cost) => sum + cost.amount, 0),
          currency: "USD",
          source: costs.some((cost) => cost.source === "provider-estimate")
            ? "provider-estimate"
            : "provider-reported",
        }
      : null,
    notes: [...new Set(receipts.flatMap((item) => (item.note ? [item.note] : [])))],
  };
};
