import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type PromoteFailure = { error: string; suggestedName?: string | undefined };

/**
 * Name the ticket branch. Pre-filled with the ticket ID; empty for description-only runs.
 * The caller remounts it (key) per opening so each opening starts from the default name.
 */
export const PromoteRunDialog = ({
  open,
  defaultName,
  runBranch,
  onOpenChange,
  onSubmit,
  returnFocus,
}: {
  open: boolean;
  defaultName: string;
  runBranch: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<PromoteFailure | null>;
  returnFocus: () => HTMLElement | null;
}) => {
  const [name, setName] = useState(defaultName);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<PromoteFailure | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();
  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setFailure(null);
    const result = await onSubmit(trimmed);
    setPending(false);
    if (result) {
      setFailure(result);
      inputRef.current?.focus();
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus()?.focus();
        }}
      >
        <DialogTitle className="text-xl font-semibold">Create ticket branch</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          Creates a local branch at the tip of {runBranch} with the same commits. Nothing is pushed,
          and an existing branch is never overwritten.
        </DialogDescription>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={inputId} className="block text-sm font-medium">
            Branch name
          </label>
          <Input
            id={inputId}
            ref={inputRef}
            value={name}
            required
            placeholder={defaultName ? undefined : "for example demo-run"}
            aria-invalid={failure ? true : undefined}
            aria-describedby={failure ? errorId : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          {failure && (
            <div id={errorId} role="alert" className="text-sm text-red-700">
              <p>{failure.error}</p>
              {failure.suggestedName && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    setName(failure.suggestedName ?? "");
                    inputRef.current?.focus();
                  }}
                >
                  Use {failure.suggestedName}
                </Button>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              {pending ? "Creating…" : "Create branch"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
