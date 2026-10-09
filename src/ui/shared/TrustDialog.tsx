import { useRef, type RefObject } from "react";
import type { TrustReview } from "../../domain/trust.js";
import { Button } from "@/shared/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/dialog";

export type TrustPrompt = { review: TrustReview; pending: boolean; error: string };
export type TrustChoice = "trust" | "cancel";

/** Exact consent strings; tests assert these so the dialog never understates what trust allows. */
export const TRUST_TEXT = {
  title: "Trust this project?",
  scope:
    "Code Factory will run this project's check and setup commands and start agents in it. Agents load the project's own settings, hooks and instructions. Only trust projects you wrote or reviewed.",
  persistence:
    "Saved for this folder in your own Code Factory settings, not in the project. Stop trusting it any time in Setup → Agent tool permission.",
} as const;

const Commands = ({ review }: { review: TrustReview }) => {
  const nothing =
    !review.setupCommand &&
    !review.runSetupCommands.length &&
    !review.customExecutable &&
    !review.checkCommands.length &&
    !review.interruptedRuns;
  if (nothing)
    return (
      <p className="mt-3 text-sm">
        This project defines no setup, check or custom agent commands yet.
      </p>
    );
  return (
    <div className="mt-3 max-h-64 space-y-2 overflow-y-auto text-sm">
      <p className="font-medium">This project&apos;s own files define:</p>
      <ul className="list-disc space-y-1 pl-5">
        {review.setupCommand && (
          <li>
            Setup command: <code className="break-all">{review.setupCommand.join(" ")}</code>
          </li>
        )}
        {review.runSetupCommands.map((item) => (
          <li key={[item.loop, ...item.command].join("\u0000")}>
            Setup command saved in a run of {item.loop}:{" "}
            <code className="break-all">{item.command.join(" ")}</code>
          </li>
        ))}
        {review.customExecutable && (
          <li>
            Custom agent executable: <code className="break-all">{review.customExecutable}</code>
          </li>
        )}
        {review.checkCommands.map((item) => (
          <li key={`${item.loop}\u0000${item.step}\u0000${item.command}`}>
            Check “{item.step}” in {item.loop}:{" "}
            <code className="break-all whitespace-pre-wrap">{item.command}</code>
          </li>
        ))}
        {review.interruptedRuns > 0 && (
          <li>
            {review.interruptedRuns} interrupted run{review.interruptedRuns === 1 ? "" : "s"}, which
            you can resume afterwards.
          </li>
        )}
      </ul>
    </div>
  );
};

/** Presentational consent dialog; the caller owns the trust request and its state. */
export const TrustDialog = ({
  prompt,
  onAnswer,
  returnFocus,
  fallbackFocus,
}: {
  prompt: TrustPrompt | null;
  onAnswer: (choice: TrustChoice) => void;
  returnFocus: () => HTMLElement | null;
  fallbackFocus: RefObject<HTMLElement | null>;
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pending = prompt?.pending ?? false;
  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onAnswer("cancel");
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocus();
          (target?.isConnected && !target.matches(":disabled")
            ? target
            : fallbackFocus.current
          )?.focus();
        }}
      >
        {prompt && (
          <>
            <DialogTitle className="text-xl font-semibold">{TRUST_TEXT.title}</DialogTitle>
            <DialogDescription className="mt-2 text-sm">{TRUST_TEXT.scope}</DialogDescription>
            <Commands review={prompt.review} />
            <p className="mt-3 text-xs text-muted-foreground">{TRUST_TEXT.persistence}</p>
            {prompt.error && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {prompt.error}
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                ref={cancelRef}
                variant="outline"
                disabled={pending}
                onClick={() => onAnswer("cancel")}
              >
                Cancel
              </Button>
              <Button disabled={pending} onClick={() => onAnswer("trust")}>
                {pending ? "Saving…" : "Trust project"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
