import { z } from "zod";
import type { UsageReport } from "../domain/usage.js";

/** A field that is absent or not a valid value is dropped; it never becomes a zero. */
const count = z.number().int().nonnegative().optional().catch(undefined);
const resultUsage = z.object({
  input_tokens: count,
  output_tokens: count,
  cache_read_input_tokens: count,
  cache_creation_input_tokens: count,
});
const cost = z.number().finite().nonnegative().optional().catch(undefined);

export const CLAUDE_USAGE_NOTE =
  "Token counts cover the main agent loop only (subagent tokens are not included); the cost is the CLI's own client-side estimate and includes subagents.";

/** What one Claude Code `result` event reports; `usage` is that turn's, `total_cost_usd` the call's running total. */
export interface ClaudeResultUsage {
  tokens: Partial<Record<"input" | "output" | "cacheRead" | "cacheWrite", number>>;
  costUsd: number | undefined;
}

export const parseClaudeResultUsage = (event: {
  usage?: unknown;
  total_cost_usd?: unknown;
}): ClaudeResultUsage => {
  const usage = resultUsage.safeParse(event.usage);
  const tokens: ClaudeResultUsage["tokens"] = {};
  if (usage.success) {
    const { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens } =
      usage.data;
    if (input_tokens !== undefined) tokens.input = input_tokens;
    if (output_tokens !== undefined) tokens.output = output_tokens;
    if (cache_read_input_tokens !== undefined) tokens.cacheRead = cache_read_input_tokens;
    if (cache_creation_input_tokens !== undefined) tokens.cacheWrite = cache_creation_input_tokens;
  }
  return { tokens, costUsd: cost.parse(event.total_cost_usd) };
};

/**
 * Folds the results of one attempt: tokens are per turn, so they add up; the cost is a running
 * total for the whole call, so the latest one stands. Returns undefined when nothing was reported.
 */
export const foldClaudeUsage = (results: ClaudeResultUsage[]): UsageReport | undefined => {
  const tokens: NonNullable<UsageReport["tokens"]> = {};
  let costUsd: number | undefined;
  for (const result of results) {
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      const value = result.tokens[key];
      if (value !== undefined) tokens[key] = (tokens[key] ?? 0) + value;
    }
    if (result.costUsd !== undefined) costUsd = result.costUsd;
  }
  const hasTokens = Object.keys(tokens).length > 0;
  if (!hasTokens && costUsd === undefined) return undefined;
  return {
    ...(hasTokens ? { tokens } : {}),
    ...(costUsd !== undefined
      ? {
          cost: { amount: costUsd, currency: "USD" as const, source: "provider-estimate" as const },
        }
      : {}),
    note: CLAUDE_USAGE_NOTE,
  };
};
