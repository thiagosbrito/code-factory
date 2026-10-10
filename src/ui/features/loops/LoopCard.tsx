import type { LoopDefinition } from "../../../domain/loop.js";
import { Button } from "@/shared/components/button";
import { Card } from "@/shared/components/card";

export const LoopCard = ({
  loop,
  versions,
  onEdit,
  onExport,
}: {
  loop: LoopDefinition;
  versions?: number[];
  onEdit?: () => void;
  onExport?: () => void;
}) => {
  return (
    <Card className="grid gap-3 bg-card p-5 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
      <div
        aria-hidden="true"
        className="flex h-16 items-center justify-around rounded-lg border bg-stone-50 text-teal-700"
      >
        <span className="rounded border bg-card px-2 py-1">1</span>
        <span>→</span>
        <span className="rounded border bg-card px-2 py-1">2</span>
        <span>→</span>
        <span className="rounded border bg-card px-2 py-1">3</span>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">
          {loop.status === "draft" ? `Draft v${loop.version}` : `Published v${loop.version}`}
        </p>
        <h3 className="font-semibold">{loop.name}</h3>
        <p className="text-sm text-muted-foreground">
          {loop.steps.length} steps
          {versions?.length
            ? ` · Publications: ${versions.map((version) => `v${version}`).join(", ")}`
            : ""}
        </p>
        {loop.status === "published" && (
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer text-teal-700">Inspect published structure</summary>
            <p className="mt-2">{`Steps: ${loop.steps.map((step) => step.name).join(", ")}`}</p>
            <p>
              {loop.groups.length} groups · {loop.joins.length} joins · {loop.decisions.length}{" "}
              decisions
            </p>
          </details>
        )}
      </div>
      <div className="flex gap-2">
        {onEdit && (
          <Button variant="outline" onClick={onEdit}>
            Edit draft
          </Button>
        )}
        {onExport && (
          <Button variant="outline" onClick={onExport}>
            Export JSON
          </Button>
        )}
      </div>
    </Card>
  );
};
