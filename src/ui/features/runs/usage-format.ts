import type { UsageCost, UsageSummary } from "../../../domain/usage.js";

export const NOT_REPORTED = "Not reported";

const count = new Intl.NumberFormat("en-US");

export const formatTokenCount = (value: number | null): string =>
  value === null ? NOT_REPORTED : count.format(value);

/** Whole cents for amounts from one dollar up, four decimals below it so small costs stay visible. */
export const formatCost = (cost: UsageCost): string =>
  `$${cost.amount.toFixed(cost.amount >= 1 ? 2 : 4)} ${cost.currency}`;

export const costBasis = (cost: UsageCost): string =>
  cost.source === "provider-estimate" ? "estimated by the provider" : "reported by the provider";

/** "2 of 3 attempts reported", or null when every attempt reported (or there is none). */
export const partialLabel = (usage: UsageSummary): string | null =>
  usage.attempts > 0 && usage.partial
    ? `Partial: ${usage.reported} of ${usage.attempts} attempt${usage.attempts === 1 ? "" : "s"} reported`
    : null;

/**
 * One line for a step card or the run header. Unreported values are named as such, never shown as
 * zero; a provider estimate reads "est."; a partial total says so.
 */
export const usageLine = (usage: UsageSummary): string => {
  if (usage.reported === 0) return `Usage ${NOT_REPORTED.toLowerCase()}`;
  const parts: string[] = [];
  if (usage.tokens) {
    const { input, output } = usage.tokens;
    if (input !== null) parts.push(`${formatTokenCount(input)} in`);
    if (output !== null) parts.push(`${formatTokenCount(output)} out`);
    if (input === null && output === null) parts.push("Input/output tokens not reported");
  } else parts.push("Tokens not reported");
  parts.push(
    usage.cost
      ? `${usage.cost.source === "provider-estimate" ? "est. " : ""}${formatCost(usage.cost)}`
      : "Cost not reported",
  );
  const partial = partialLabel(usage);
  return partial ? `${parts.join(" · ")} (partial)` : parts.join(" · ");
};
