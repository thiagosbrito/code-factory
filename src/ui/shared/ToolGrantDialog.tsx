import { useEffect, useRef, type RefObject } from "react";
import type { GrantableProvider } from "../../domain/tool-grant.js";
import { Button } from "@/shared/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/dialog";

export type ToolGrantChoice = "grant" | "decline" | "cancel";
export type ToolGrantPrompt = { provider: GrantableProvider; pending: boolean; error: string };

/** Exact consent strings; tests assert these so the dialog never understates the grant. */
export const toolGrantText: Record<
  GrantableProvider,
  { title: string; scope: string; implication: string; decline: string }
> = {
  kiro: {
    title: "Allow Kiro to run shell commands?",
    decline: "Run without shell",
    scope:
      "Code Factory will add `execute_bash` to Kiro's trusted tools (`--trust-tools=fs_read,fs_write,execute_bash`) for every Kiro step in this project.",
    implication:
      "The agent can run any command with your account's permissions, without asking, in any directory it chooses. Commands it runs work in your project checkout and can change its files, branches, stash and config.",
  },
  codex: {
    title: "Allow Codex to run commands outside its sandbox?",
    // Codex still runs in-sandbox commands by default, so "without shell" would misdescribe it.
    decline: "Keep commands sandboxed",
    scope:
      "Code Factory will accept a Codex command approval request only when the command's working directory is inside the run's project folder, for every Codex step in this project. Codex's separate network-access prompts and file-change approvals stay declined.",
    implication:
      "An approved command runs outside Codex's sandbox with your account's permissions, including network access and writes outside the project. It can change your repository's branches, stash and config.",
  },
  "claude-code": {
    title: "Allow Claude Code to run shell commands?",
    decline: "Run without shell",
    scope:
      "Code Factory will start every Claude Code step in this project with `--allowedTools Bash` instead of `--disallowedTools Bash`.",
    implication:
      "The agent can run any command with your account's permissions, without asking, in any directory it chooses. Commands it runs work in your project checkout and can change its files, branches, stash and config.",
  },
};
export const TOOL_GRANT_PERSISTENCE =
  "Saved for this project in trust.json in your Code Factory user folder, never in the project's own files. Revoke it any time in Setup → Agent tool permission.";

/** Presentational consent dialog; the caller owns the grant request and its state. */
export const ToolGrantDialog = ({
  mode,
  prompt,
  onAnswer,
  returnFocus,
  fallbackFocus,
}: {
  mode: "run" | "settings";
  prompt: ToolGrantPrompt | null;
  onAnswer: (choice: ToolGrantChoice) => void;
  returnFocus: () => HTMLElement | null;
  fallbackFocus: RefObject<HTMLElement | null>;
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const provider = prompt?.provider;
  // Between providers the dialog stays open; move focus back to the safe choice.
  useEffect(() => {
    if (provider) cancelRef.current?.focus();
  }, [provider]);
  const text = provider ? toolGrantText[provider] : null;
  const pending = prompt?.pending ?? false;
  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open && !prompt?.pending) onAnswer("cancel");
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
        {text && (
          <>
            <DialogTitle className="text-xl font-semibold">{text.title}</DialogTitle>
            <DialogDescription className="mt-2 text-sm">{text.scope}</DialogDescription>
            <p className="mt-3 text-sm font-medium text-amber-900">{text.implication}</p>
            <p className="mt-3 text-xs text-muted-foreground">{TOOL_GRANT_PERSISTENCE}</p>
            {prompt?.error && (
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
              {mode === "run" && (
                <Button variant="outline" disabled={pending} onClick={() => onAnswer("decline")}>
                  {text.decline}
                </Button>
              )}
              <Button disabled={pending} onClick={() => onAnswer("grant")}>
                {pending ? "Saving…" : mode === "run" ? "Allow and run" : "Allow"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
