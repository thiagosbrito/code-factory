import type { StepFacts } from "./step-facts";

/** The Agent, Model and Effort lines of a step card; each truncates instead of widening the card. */
export const StepFactsLines = ({
  facts,
  className = "",
}: {
  facts: StepFacts;
  className?: string;
}) => (
  <dl
    className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 text-[10.5px] leading-[14px] ${className}`}
    {...(facts.inherited ? { title: "Inherited from the project default" } : {})}
  >
    {(
      [
        ["Agent", facts.agent],
        ["Model", facts.model],
        ["Effort", facts.effort],
      ] as const
    ).map(([label, value]) => (
      <div key={label} className="contents">
        <dt className="text-muted-foreground">{label}:</dt>
        <dd className="m-0 truncate font-medium">{value}</dd>
      </div>
    ))}
  </dl>
);
