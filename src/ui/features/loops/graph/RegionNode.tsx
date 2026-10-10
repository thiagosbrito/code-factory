import type { NodeProps } from "@xyflow/react";
import type { RegionFlowNode } from "./graph-mapping";

/**
 * A group region: a labelled frame around the group's members. Parallel groups are dashed and
 * repeat groups are solid, so the kind never depends on colour alone. It takes no pointer events.
 */
export const RegionNode = ({ data }: NodeProps<RegionFlowNode>) => (
  <div className={`graph-region graph-region-${data.kind} h-full w-full rounded-lg`}>
    <span className="graph-region-label">{data.label}</span>
  </div>
);
