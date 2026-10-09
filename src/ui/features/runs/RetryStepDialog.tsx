import type { RunRecord } from "../../../domain/run.js";
import { getDependentStepIds } from "../../../domain/loop.js";
import { Button } from "@/shared/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/dialog";

export const RetryStepDialog = ({
  run,
  stepId,
  open,
  onOpenChange,
  onConfirm,
  onCloseAutoFocus,
}: {
  run: RunRecord;
  stepId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) => {
  const step = run.steps.find((item) => item.stepId === stepId);
  const definition = run.snapshot.loop.steps.find((item) => item.id === stepId);
  if (!step || !definition) return null;
  const descendants = new Set(getDependentStepIds(run.snapshot.loop, stepId));
  const stale = run.steps.filter(
    (item) => descendants.has(item.stepId) && item.status !== "pending",
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          New step attempt
        </p>
        <DialogTitle className="mt-2 text-xl font-semibold">Retry {definition.name}?</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          Create Attempt {step.attempts.length + 1} for {definition.name} ({stepId}) in this run
          only. The attempt limit is separate from the loop’s{" "}
          {run.snapshot.loop.policy.maxImplementationRounds} total implementation rounds.
        </DialogDescription>
        <div className="mt-5 space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
          <p>
            <strong>Retained edits</strong>
            <br />
            Existing workspace changes remain available to this attempt.
          </p>
          <p>
            <strong>Retained evidence</strong>
            <br />
            Earlier attempts, logs, files, and artifacts remain inspectable.
          </p>
          <p>
            <strong>Results needing revalidation</strong>
            <br />
            {stale.length
              ? stale
                  .map(
                    (item) =>
                      run.snapshot.loop.steps.find((node) => node.id === item.stepId)?.name ??
                      item.stepId,
                  )
                  .join(", ")
              : "No completed downstream results."}{" "}
            Independent completed siblings remain complete.
          </p>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Start Attempt {step.attempts.length + 1}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
