import { Handle, Position, type NodeProps } from "@xyflow/react";
import { StepFactsLines } from "../../../shared/StepFactsLines";
import { useStepFacts } from "./StepFactsContext";
import type { StepFlowNode } from "./graph-mapping";

/**
 * One step: name, role, kind and stage, with the output handle on the right and input on the left.
 * A step that cannot start a connection (a decision) keeps its output handle but marks it
 * disabled, with the reason as its tooltip and label; the structure note is read by screen readers.
 */
export const StepNode = ({ id, data, selected }: NodeProps<StepFlowNode>) => {
  const facts = useStepFacts(id);
  return (
    <div
      className={`h-full w-full overflow-hidden rounded-md border bg-card px-3 py-2 shadow-sm ${
        selected ? "ring-2 ring-primary" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} className="graph-handle" />
      <p className="truncate text-xs font-semibold">{data.name}</p>
      <p className="truncate text-[11px] text-muted-foreground">
        {data.role} · {data.kind}
      </p>
      {facts && <StepFactsLines facts={facts} className="mt-1" />}
      <div className="mt-1 flex min-w-0 flex-nowrap gap-1 overflow-hidden">
        {/* The lane already names the stage; with many badges the chip makes way so the row never clips. */}
        {data.badges.length < 3 && (
          <span className="shrink-0 rounded border px-1.5 text-[10px] text-muted-foreground">
            {data.stageLabel}
          </span>
        )}
        {data.badges.map((badge) => (
          <span
            key={badge}
            title={badge}
            className="min-w-0 truncate rounded border px-1.5 text-[10px] text-primary"
          >
            {badge}
          </span>
        ))}
      </div>
      {data.note && <p className="sr-only">{data.note}</p>}
      <Handle
        type="source"
        position={Position.Right}
        className="graph-handle"
        isConnectableStart={data.startBlocked === null}
        {...(data.startBlocked
          ? {
              "aria-disabled": true,
              "aria-label": data.startBlocked,
              title: data.startBlocked,
            }
          : {})}
      />
    </div>
  );
};
