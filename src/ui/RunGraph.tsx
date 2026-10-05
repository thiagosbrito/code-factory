import { useRef, useState } from "react";
import type { RunRecord } from "../domain/run.js";
import { Button } from "@/components/ui/button";

type Point = { x: number; y: number };
const nodeWidth = 210;
const nodeHeight = 102;
const positions = (run: RunRecord): Map<string, Point> => {
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (depths.has(id)) return depths.get(id) ?? 0;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const incoming = run.snapshot.loop.dependencies.filter((edge) => edge.to === id);
    const value = incoming.length ? Math.max(...incoming.map((edge) => depth(edge.from) + 1)) : 0;
    visiting.delete(id);
    depths.set(id, value);
    return value;
  };
  run.snapshot.loop.steps.forEach((step) => depth(step.id));
  const rows = new Map<number, number>();
  return new Map(
    run.snapshot.loop.steps.map((step) => {
      const column = depths.get(step.id) ?? 0;
      const row = rows.get(column) ?? 0;
      rows.set(column, row + 1);
      return [step.id, step.position ?? { x: 40 + column * 290, y: 55 + row * 165 }];
    }),
  );
};

export const RunGraph = ({
  run,
  selectedStepId,
  onSelect,
}: {
  run: RunRecord;
  selectedStepId: string | null;
  onSelect: (id: string) => void;
}) => {
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLElement>(null);
  const layout = positions(run);
  const width = Math.max(700, ...[...layout.values()].map((point) => point.x + nodeWidth + 60));
  const height = Math.max(340, ...[...layout.values()].map((point) => point.y + nodeHeight + 70));
  const moveSelection = (id: string, direction: number) => {
    const ids = run.snapshot.loop.steps.map((step) => step.id);
    const index = ids.indexOf(id);
    const next = ids[Math.max(0, Math.min(ids.length - 1, index + direction))];
    if (next) {
      onSelect(next);
      window.requestAnimationFrame(() => document.getElementById(`run-node-${next}`)?.focus());
    }
  };
  return (
    <section className="mt-6" aria-label="Execution graph">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h3 className="font-semibold">Execution</h3>
          <p className="text-xs text-muted-foreground">
            Observed graph · node positions do not change execution order
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-label="Zoom out"
            onClick={() => setZoom((value) => Math.max(0.25, +(value - 0.1).toFixed(2)))}
          >
            −
          </Button>
          <output className="min-w-11 text-center text-xs">{Math.round(zoom * 100)}%</output>
          <Button
            size="sm"
            variant="outline"
            aria-label="Zoom in"
            onClick={() => setZoom((value) => Math.min(1.5, +(value + 0.1).toFixed(2)))}
          >
            +
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setZoom(
                Math.max(
                  0.25,
                  Math.min(
                    1,
                    ((canvasRef.current?.clientWidth || window.innerWidth - 320) - 24) / width,
                  ),
                ),
              )
            }
          >
            Fit view
          </Button>
        </div>
      </div>
      <section
        ref={canvasRef}
        className="run-graph-canvas mt-3 overflow-auto rounded-lg border"
        aria-label="Step graph"
      >
        <div className="relative" style={{ width: width * zoom, height: height * zoom }}>
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ width, height, transform: `scale(${zoom})` }}
          >
            {run.snapshot.loop.groups.map((group) => {
              const points = group.stepIds
                .map((id) => layout.get(id))
                .filter((point): point is Point => Boolean(point));
              if (!points.length) return null;
              const left = Math.min(...points.map((point) => point.x)) - 18;
              const top = Math.min(...points.map((point) => point.y)) - 34;
              const right = Math.max(...points.map((point) => point.x)) + nodeWidth + 18;
              const bottom = Math.max(...points.map((point) => point.y)) + nodeHeight + 18;
              return (
                <div
                  key={group.id}
                  className="absolute rounded-xl border border-dashed border-primary/40 bg-primary/5"
                  style={{ left, top, width: right - left, height: bottom - top }}
                >
                  <span className="absolute -top-5 left-2 text-xs font-semibold text-primary">
                    {group.name} · {group.kind}
                  </span>
                </div>
              );
            })}
            <svg
              className="pointer-events-none absolute inset-0"
              width={width}
              height={height}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="run-graph-arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0 0 L8 4 L0 8" fill="none" stroke="#8b9690" />
                </marker>
              </defs>
              {run.snapshot.loop.dependencies.map((edge) => {
                const from = layout.get(edge.from);
                const to = layout.get(edge.to);
                if (!from || !to) return null;
                const x1 = from.x + nodeWidth;
                const y1 = from.y + nodeHeight / 2;
                const x2 = to.x;
                const y2 = to.y + nodeHeight / 2;
                return (
                  <path
                    key={`${edge.from}:${edge.to}`}
                    d={`M${x1} ${y1} C${x1 + 40} ${y1},${x2 - 40} ${y2},${x2 - 8} ${y2}`}
                    fill="none"
                    stroke="#8b9690"
                    strokeWidth="1.5"
                    markerEnd="url(#run-graph-arrow)"
                  />
                );
              })}
            </svg>
            {run.snapshot.loop.steps.map((definition) => {
              const point = layout.get(definition.id);
              const step = run.steps.find((item) => item.stepId === definition.id);
              if (!point) return null;
              const status = step?.status ?? "pending";
              return (
                <button
                  key={definition.id}
                  id={`run-node-${definition.id}`}
                  type="button"
                  style={{ left: point.x, top: point.y, width: nodeWidth, minHeight: nodeHeight }}
                  className={`run-graph-node run-graph-node-${status} absolute rounded-lg border bg-white p-3 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedStepId === definition.id ? "ring-2 ring-primary" : ""}`}
                  aria-label={`${definition.name}, ${status}, ${step?.attempts.length ?? 0} attempts`}
                  aria-pressed={selectedStepId === definition.id}
                  onClick={() => onSelect(definition.id)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                      event.preventDefault();
                      moveSelection(definition.id, 1);
                    }
                    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                      event.preventDefault();
                      moveSelection(definition.id, -1);
                    }
                  }}
                >
                  <span className={`run-status run-status-${status}`}>{status}</span>
                  <strong className="mt-2 block text-sm">{definition.name}</strong>
                  <span className="block text-xs text-muted-foreground">
                    {definition.role} · {step?.attempts.length ?? 0} attempts
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
      <p className="mt-2 text-xs text-muted-foreground">
        Use arrow keys to move between nodes. Enter opens the selected step.
      </p>
    </section>
  );
};
