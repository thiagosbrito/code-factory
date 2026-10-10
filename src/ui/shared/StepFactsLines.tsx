import type { StepFacts } from "./step-facts";

const rows = (facts: StepFacts) =>
  [
    ["Agent", facts.agent],
    ["Model", facts.model],
    ["Effort", facts.effort],
  ] as const;

const grid = "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 text-[10.5px] leading-[14px]";

/**
 * The Agent, Model and Effort lines of a step card; each truncates instead of widening the card
 * and carries its full text as a tooltip. A card that is itself a button cannot hold a description
 * list (a button takes only phrasing content), so `inline` draws the same lines from spans, hidden
 * from assistive technology because that card's label already says them.
 */
export const StepFactsLines = ({
  facts,
  className = "",
  inline = false,
}: {
  facts: StepFacts;
  className?: string;
  inline?: boolean;
}) => {
  const title = facts.inherited ? "Inherited from the project default" : undefined;
  if (inline)
    return (
      <span aria-hidden="true" title={title} className={`${grid} ${className}`}>
        {rows(facts).map(([label, value]) => (
          <span key={label} className="contents">
            <span className="text-muted-foreground">{label}:</span>
            <span title={value} className="truncate font-medium">
              {value}
            </span>
          </span>
        ))}
      </span>
    );
  return (
    <dl {...(title ? { title } : {})} className={`${grid} ${className}`}>
      {rows(facts).map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}:</dt>
          <dd title={value} className="m-0 truncate font-medium">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
};
