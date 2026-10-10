import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StepFlowNode } from "./graph-mapping";

/** One step: name, role, kind and stage, with the output handle on the right and input on the left. */
export const StepNode = ({ data, selected }: NodeProps<StepFlowNode>) => (
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
    <div className="mt-1 flex min-w-0 gap-1">
      <span className="shrink-0 rounded border px-1.5 text-[10px] text-muted-foreground">
        {data.stageLabel}
      </span>
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
    <Handle type="source" position={Position.Right} className="graph-handle" />
  </div>
);
