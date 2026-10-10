import { Button } from "@/shared/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/dialog";
import { linksOf, linkTargets, type StepLink } from "./graph-linking";
import type { LoopDefinition } from "../../../../domain/loop.js";

export type LinkRequest = { mode: "connect" | "disconnect"; stepId: string };

const itemClass =
  "flex w-full flex-col items-start rounded-md border px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

/**
 * Keyboard and screen-reader linking: the same connect and disconnect the mouse offers, as lists.
 * A refused target stays in the list with its reason (aria-disabled, so it can still be focused
 * and read); activating it reports the reason through `onRefused` and leaves the dialog open.
 */
export const LinkDialog = ({
  loop,
  request,
  onConnect,
  onRefused,
  onDisconnect,
  onClose,
  onClosed,
}: {
  loop: LoopDefinition;
  request: LinkRequest | null;
  onConnect: (from: string, to: string) => void;
  onRefused: (reason: string) => void;
  onDisconnect: (link: StepLink) => void;
  onClose: () => void;
  /** Called once the dialog has closed, so focus can return to the step it was opened from. */
  onClosed: () => void;
}) => {
  const step = request ? loop.steps.find((item) => item.id === request.stepId) : undefined;
  const open = Boolean(request && step);
  const targets = request?.mode === "connect" && step ? linkTargets(loop, step.id) : [];
  const links = request?.mode === "disconnect" && step ? linksOf(loop, step.id) : null;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
      >
        <DialogTitle className="text-base font-semibold">
          {request?.mode === "connect"
            ? `Connect ${step?.name ?? "step"} to…`
            : `Disconnect ${step?.name ?? "step"}`}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm">
          {request?.mode === "connect"
            ? "Choose the step that runs after it. Unavailable steps say why."
            : "Choose a dependency to remove."}
        </DialogDescription>
        {request?.mode === "connect" && (
          <ul aria-label="Steps to connect to" className="mt-3 grid max-h-72 gap-1.5 overflow-auto">
            {targets.map((target) => (
              <li key={target.id}>
                <button
                  type="button"
                  className={itemClass}
                  aria-disabled={target.connected || target.reason !== null}
                  onClick={() =>
                    target.reason
                      ? onRefused(target.reason)
                      : !target.connected && onConnect(step?.id ?? "", target.id)
                  }
                >
                  <span className="font-medium">{target.name}</span>
                  {target.connected && (
                    <span className="text-xs text-muted-foreground">Already connected</span>
                  )}
                  {target.reason && (
                    <span className="text-xs text-muted-foreground">{target.reason}</span>
                  )}
                </button>
              </li>
            ))}
            {!targets.length && (
              <li className="text-sm text-muted-foreground">There are no other steps.</li>
            )}
          </ul>
        )}
        {links && (
          <div className="mt-3 grid gap-3">
            {(
              [
                ["Runs after (incoming)", links.incoming],
                ["Runs before (outgoing)", links.outgoing],
              ] as const
            ).map(([heading, list]) => (
              <section key={heading} aria-label={heading}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {heading}
                </h3>
                <ul className="mt-1 grid gap-1.5">
                  {list.map((link) => (
                    <li key={`${link.from}:${link.to}`}>
                      <button
                        type="button"
                        className={itemClass}
                        onClick={() => onDisconnect(link)}
                      >
                        Remove {link.fromName} → {link.toName}
                      </button>
                    </li>
                  ))}
                  {!list.length && <li className="text-sm text-muted-foreground">None</li>}
                </ul>
              </section>
            ))}
          </div>
        )}
        <div className="mt-5 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
