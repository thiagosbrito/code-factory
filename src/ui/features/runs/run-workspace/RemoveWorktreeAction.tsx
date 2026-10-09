import { useId, useRef, useState, type RefObject } from "react";
import { REMOVAL_DIRTY, type RunWorkspace } from "../../../../domain/run-branch.js";
import { Button } from "@/shared/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/dialog";
import { firstConnected } from "./focus";

/** The "Remove worktree…" button and its confirmation dialog; branches are always kept. */
export const RemoveWorktreeAction = ({
  workspace,
  branch,
  showTrigger,
  connected,
  busy,
  fallbackTargets,
  onRemove,
  announce,
}: {
  workspace: RunWorkspace;
  branch: string;
  /** The button is offered for a present worktree; the dialog stays mounted regardless. */
  showTrigger: boolean;
  connected: boolean;
  busy: boolean;
  /** Where focus goes when the trigger is gone after a successful removal. */
  fallbackTargets: readonly RefObject<HTMLElement | null>[];
  onRemove: () => Promise<string | null>;
  announce: (message: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const helpId = useId();
  return (
    <>
      {showTrigger && (
        <div>
          <Button
            ref={trigger}
            variant="outline"
            disabled={!connected || busy}
            aria-describedby={workspace.removalBlocked ? helpId : undefined}
            onClick={() => {
              setError("");
              setOpen(true);
            }}
          >
            Remove worktree…
          </Button>
          {workspace.removalBlocked && (
            <p id={helpId} className="mt-1 text-xs text-muted-foreground">
              {REMOVAL_DIRTY}
            </p>
          )}
        </div>
      )}
      <Dialog open={open} onOpenChange={(next) => !removing && setOpen(next)}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            firstConnected(
              trigger.current,
              ...fallbackTargets.map((target) => target.current),
            )?.focus();
          }}
        >
          <DialogTitle className="text-xl font-semibold">Remove the worktree?</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            Branch {branch}
            {workspace.promotion
              ? ` and ticket branch ${workspace.promotion.branch} are`
              : " and any ticket branch are"}{" "}
            kept. Uncommitted changes block removal.
          </DialogDescription>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" disabled={removing} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={removing}
              onClick={() => {
                setRemoving(true);
                void onRemove().then((failure) => {
                  setRemoving(false);
                  if (failure) setError(failure);
                  else {
                    setOpen(false);
                    announce("Worktree removed. Branches are kept.");
                  }
                });
              }}
            >
              {removing ? "Removing…" : "Remove worktree"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
