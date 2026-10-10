import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import type { DependencyFlowEdge } from "./graph-mapping";

/** The default curved edge plus a delete control while selected; keys Delete and Backspace also work. */
export const DependencyEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
  interactionWidth,
  data,
}: EdgeProps<DependencyFlowEdge>) => {
  const { deleteElements } = useReactFlow();
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const label = data?.label ?? "Dependency";
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd ? { markerEnd } : {})}
        {...(interactionWidth ? { interactionWidth } : {})}
      />
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label={`Delete: ${label}`}
            className="nodrag nopan graph-edge-delete"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onClick={(event) => {
              // The button unmounts with its edge; keep focus in the graph instead of losing it.
              const region = event.currentTarget.closest(".react-flow");
              void deleteElements({ edges: [{ id }] }).then(() => {
                if (region instanceof HTMLElement) region.focus();
              });
            }}
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
