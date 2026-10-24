import type { UsageSummary } from "../../../domain/usage.js";
import {
  costBasis,
  formatCost,
  formatTokenCount,
  NOT_REPORTED,
  partialLabel,
  usageLine,
} from "./usage-format";

/**
 * The step card's usage line. Nothing shows while the step has no attempt, or while its first
 * attempt is still running and has reported nothing yet; a finished step that reported nothing says so.
 */
export const StepUsageLine = ({
  usage,
  settled,
}: {
  usage: UsageSummary;
  /** Every attempt has ended, so a missing report is final. */
  settled: boolean;
}) =>
  usage.attempts === 0 || (usage.reported === 0 && !settled) ? null : (
    <span
      data-testid="step-usage"
      className="mt-1 block truncate text-[10.5px] leading-[14px] text-muted-foreground"
      title={usageLine(usage)}
    >
      {usageLine(usage)}
    </span>
  );

/** The run's total, in the run header. */
export const RunUsageTotal = ({ usage }: { usage: UsageSummary }) =>
  usage.attempts === 0 ? null : (
    <span aria-label={`Run usage: ${usageLine(usage)}`} title={partialLabel(usage) ?? undefined}>
      Usage: {usageLine(usage)}
    </span>
  );

/** Every usage fact of the inspected run, step or attempt, with the provider's own caveats. */
export const UsageDetails = ({ usage, title }: { usage: UsageSummary; title: string }) => (
  <section aria-label="Usage">
    <h4 className="font-semibold">{title}</h4>
    {usage.attempts === 0 ? (
      <p className="mt-2 text-muted-foreground">No attempt has run yet.</p>
    ) : usage.reported === 0 ? (
      <p className="mt-2 text-muted-foreground">
        {NOT_REPORTED}: the agent that ran{" "}
        {usage.attempts === 1 ? "this attempt" : "these attempts"} did not report token usage or
        cost.
      </p>
    ) : (
      <dl className="run-details-grid mt-2">
        <dt>Input tokens</dt>
        <dd>{formatTokenCount(usage.tokens?.input ?? null)}</dd>
        <dt>Output tokens</dt>
        <dd>{formatTokenCount(usage.tokens?.output ?? null)}</dd>
        <dt>Cache read tokens</dt>
        <dd>{formatTokenCount(usage.tokens?.cacheRead ?? null)}</dd>
        <dt>Cache write tokens</dt>
        <dd>{formatTokenCount(usage.tokens?.cacheWrite ?? null)}</dd>
        <dt>Cost</dt>
        <dd>{usage.cost ? `${formatCost(usage.cost)}, ${costBasis(usage.cost)}` : NOT_REPORTED}</dd>
        <dt>Coverage</dt>
        <dd>
          {partialLabel(usage) ??
            `${usage.reported} of ${usage.attempts} attempt${usage.attempts === 1 ? "" : "s"} reported`}
        </dd>
        {usage.notes.length > 0 && (
          <>
            <dt>Note</dt>
            <dd>{usage.notes.join(" ")}</dd>
          </>
        )}
      </dl>
    )}
  </section>
);
