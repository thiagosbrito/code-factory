import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { ContinuationFlowEdge } from "./graph-mapping";

/**
 * A repeat group's `continueWhen` back arrow. It is not a dependency: it draws no interaction
 * area, takes no pointer events and cannot be selected, focused or deleted.
 */
export const ContinuationEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<ContinuationFlowEdge>) => {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  return (
    <>
      <path
        id={id}
        d={path}
        fill="none"
        className="graph-continue-path"
        {...(markerEnd ? { markerEnd } : {})}
      />
      <EdgeLabelRenderer>
        <span
          className="graph-continue-label"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {data?.label ?? "repeat"} (repeat)
        </span>
      </EdgeLabelRenderer>
    </>
  );
};
