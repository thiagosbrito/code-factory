import type { NodeProps } from "@xyflow/react";
import { useLaneActions } from "./LaneActions";
import type { LaneFlowNode } from "./graph-mapping";

/** A stage lane: a backdrop that names the stage and offers adding a step to it. */
export const LaneNode = ({ data }: NodeProps<LaneFlowNode>) => {
  const actions = useLaneActions();
  return (
    <div className="graph-lane h-full w-full rounded-lg border bg-muted/40">
      <div className="border-b px-3 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">{data.title}</h4>
          {actions && (
            <button
              type="button"
              aria-label={`Add step to ${data.title}`}
              // Lanes are not interactive nodes, so the library would otherwise swallow the pointer.
              className="nodrag nopan pointer-events-auto rounded border bg-background px-1.5 text-[11px] font-medium hover:bg-accent"
              onClick={() => actions.addStep(data.stage)}
            >
              + Add step
            </button>
          )}
        </div>
        <p className="truncate text-[11px] text-muted-foreground">{data.description}</p>
      </div>
    </div>
  );
};
