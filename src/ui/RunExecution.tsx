import type { RunRecord } from "../domain/run.js";
import { Button } from "@/components/ui/button";
import { RunActivity } from "./RunActivity";

export const RunExecution = ({
  run,
  executing,
  onExecute,
  onCancel,
  connected = true,
}: {
  run: RunRecord;
  executing: boolean;
  onExecute: () => void;
  onCancel: () => void;
  connected?: boolean;
}) => {
  const reviews = run.evidence.filter((item) => item.kind === "review");
  const checks = run.evidence.filter((item) => item.kind === "check");
  return (
    <section className="mt-6 space-y-4" aria-label="Execution">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">Execution · round {run.implementationRound}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {run.status === "rejected"
              ? "Review rejected the final permitted candidate. The workspace and evidence remain available."
              : run.status === "unavailable"
                ? "Execution is unavailable or recovery could not be verified. Inspect activity before retrying."
                : run.status === "blocked"
                  ? "A reviewer could not finish its review. The candidate and evidence remain available."
                  : run.status === "failed"
                    ? "A step failed. Its attempts and evidence remain available."
                    : run.status === "canceled"
                      ? "Execution was canceled."
                      : run.status === "succeeded"
                        ? "All required steps completed."
                        : "Steps start when their declared inputs are ready."}
          </p>
        </div>
        {run.status === "pending" && (
          <Button onClick={onExecute} disabled={executing}>
            {executing ? "Executing…" : "Execute run"}
          </Button>
        )}
        {(executing || ["running", "waiting-input", "paused"].includes(run.status)) &&
          connected && (
            <Button variant="outline" onClick={onCancel}>
              Cancel run
            </Button>
          )}
      </div>
      <ol className="space-y-2">
        {run.snapshot.loop.steps.map((definition) => {
          const step = run.steps.find((item) => item.stepId === definition.id);
          return (
            <li key={definition.id} className="rounded-md border p-3 text-sm">
              <div className="flex justify-between gap-3">
                <strong>{definition.name}</strong>
                <span>{step?.status ?? "pending"}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {definition.kind} · {step?.attempts.length ?? 0} attempts
                {step?.outcome ? ` · ${step.outcome}` : ""}
              </p>
              {step?.candidateId && (
                <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                  Candidate {step.candidateId}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {(reviews.length > 0 || checks.length > 0) && (
        <div className="text-xs text-muted-foreground">
          {reviews.length} review receipts · {checks.length} check receipts
        </div>
      )}
      <RunActivity run={run} connected={connected} />
    </section>
  );
};
