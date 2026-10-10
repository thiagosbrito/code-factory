import { Button } from "@/shared/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/dialog";

/**
 * Asks before a change the model accepts but that loses or alters something. Cancel (the first
 * control, so it takes the initial focus) and Escape change nothing; Confirm applies the change
 * as one undo entry. Closing hands focus back to the graph rather than to a removed element.
 */
export const ConfirmPanel = ({
  warnings,
  onConfirm,
  onCancel,
  onClosed,
}: {
  /** The warnings to confirm, or null while nothing is pending. */
  warnings: string[] | null;
  onConfirm: () => void;
  onCancel: () => void;
  onClosed: () => void;
}) => (
  <Dialog
    open={warnings !== null}
    onOpenChange={(open) => {
      if (!open) onCancel();
    }}
  >
    <DialogContent
      className="max-w-md"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        onClosed();
      }}
    >
      <DialogTitle className="text-base font-semibold">Apply this change?</DialogTitle>
      <DialogDescription className="mt-1 text-sm">
        This change is allowed, but it also does the following.
      </DialogDescription>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
        {(warnings ?? []).map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onConfirm}>Apply change</Button>
      </div>
    </DialogContent>
  </Dialog>
);
