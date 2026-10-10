import type { NodeProps } from "@xyflow/react";
import type { LaneFlowNode } from "./graph-mapping";

/** A stage lane: a non-interactive backdrop that names the stage. */
export const LaneNode = ({ data }: NodeProps<LaneFlowNode>) => (
  <div className="graph-lane h-full w-full rounded-lg border bg-muted/40">
    <div className="border-b px-3 py-1.5">
      <h4 className="text-sm font-semibold">{data.title}</h4>
      <p className="truncate text-[11px] text-muted-foreground">{data.description}</p>
    </div>
  </div>
);
