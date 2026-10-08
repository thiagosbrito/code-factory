import { useId, useRef, useState } from "react";
import type { EvidenceSummary } from "../domain/acceptance.js";
import { promotionBlocker, REMOVAL_DIRTY, type RunWorkspace } from "../domain/run-branch.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { shellQuote, useCopyAnnouncer } from "./clipboard";
import { PromoteRunDialog, type PromoteFailure } from "./PromoteRunDialog";

const EDITOR_KEY = "code-factory.editor-command";
export const EDITORS = [
  { cli: "code", label: "VS Code" },
  { cli: "kiro", label: "Kiro" },
  { cli: "cursor", label: "Cursor" },
] as const;
type EditorCli = (typeof EDITORS)[number]["cli"];
const storedEditor = (): EditorCli => {
  try {
    const value = window.localStorage.getItem(EDITOR_KEY);
    return EDITORS.find((item) => item.cli === value)?.cli ?? "code";
  } catch {
    return "code";
  }
};

export const openInEditorCommand = (cli: string, path: string): string =>
  `${cli} -n ${shellQuote(path)}`;

/**
 * Run branch, project or worktree path, copy helpers, commit list, promotion, and either the way
 * back to the branch an in-project run switched from or (legacy runs) worktree removal.
 */
export const RunWorkspacePanel = ({
  workspace,
  summary,
  connected,
  busy,
  onPromote,
  onRemove,
  onReturn,
}: {
  workspace: RunWorkspace;
  summary: EvidenceSummary | null;
  connected: boolean;
  busy: boolean;
  onPromote: (name: string) => Promise<PromoteFailure | { warning?: string }>;
  onRemove: () => Promise<string | null>;
  onReturn: () => Promise<string | null>;
}) => {
  const { message, setMessage, copiedKey, copy } = useCopyAnnouncer();
  const [editor, setEditor] = useState<EditorCli>(storedEditor);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteOpenings, setPromoteOpenings] = useState(0);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [warning, setWarning] = useState("");
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState("");
  const promoteTrigger = useRef<HTMLButtonElement>(null);
  const removeTrigger = useRef<HTMLButtonElement>(null);
  const branchRef = useRef<HTMLElement>(null);
  const pathRef = useRef<HTMLElement>(null);
  const commandRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const promotionRef = useRef<HTMLParagraphElement>(null);
  const copyBranchRef = useRef<HTMLButtonElement>(null);
  /** First still-mounted target: a dialog's trigger unmounts once its action succeeds. */
  const firstConnected = (...targets: (HTMLElement | null)[]): HTMLElement | null =>
    targets.find((target) => target?.isConnected) ?? null;
  const headingId = useId();
  const promoteHelpId = useId();
  const removeHelpId = useId();
  const editorId = useId();
  const setupNoteId = useId();
  const returnHelpId = useId();
  if (workspace.kind !== "worktree" && workspace.kind !== "project") return null;
  const inProject = workspace.kind === "project";
  const checkout = workspace.checkout;
  const previous = checkout
    ? (checkout.previousBranch ?? `${checkout.previousRevision.slice(0, 7)} (detached)`)
    : "";
  const blocker = summary
    ? promotionBlocker(summary, workspace)
    : "Accept the evidence before creating a ticket branch.";
  const present = workspace.state === "present";
  const branch = workspace.branch ?? "";
  const path = workspace.path ?? "";
  const command = openInEditorCommand(editor, path);
  return (
    <section aria-labelledby={headingId} className="rounded-lg border bg-white p-5">
      <output aria-live="polite" className="sr-only">
        {message}
      </output>
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold">
        Run branch
      </h3>
      {inProject && checkout && (
        <p className="mt-1 text-sm text-muted-foreground">
          {checkout.onRunBranch
            ? `Your project checkout is on this branch (it was on ${previous}).`
            : `Your project checkout is now on ${checkout.current ?? "a detached HEAD"}; this run's commits stay on ${branch}.`}
        </p>
      )}
      {inProject && workspace.state === "missing" && (
        <p className="mt-1 text-sm text-amber-800">Branch {branch} no longer exists.</p>
      )}
      {!inProject && workspace.state === "removed" && (
        <p className="mt-1 text-sm text-muted-foreground">Worktree removed · branch kept</p>
      )}
      {!inProject && workspace.state === "missing" && (
        <p className="mt-1 text-sm text-amber-800">
          Worktree missing at {path}; branch {branch} is kept.
        </p>
      )}
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-center">
        <dt className="font-medium">Branch</dt>
        <dd className="break-all font-mono text-xs">
          <code ref={branchRef}>{branch}</code>
        </dd>
        <dd>
          <Button
            ref={copyBranchRef}
            size="sm"
            variant="outline"
            onClick={() => void copy("branch", "Branch name", branch, branchRef.current)}
          >
            {copiedKey === "branch" ? "Copied" : "Copy branch"}
          </Button>
        </dd>
        <dt className="font-medium">{inProject ? "Project" : "Worktree"}</dt>
        <dd className="break-all font-mono text-xs">
          <code ref={pathRef}>{path}</code>
        </dd>
        <dd>
          <Button
            size="sm"
            variant="outline"
            disabled={!path}
            onClick={() =>
              void copy("path", inProject ? "Project path" : "Worktree path", path, pathRef.current)
            }
          >
            {copiedKey === "path" ? "Copied" : "Copy path"}
          </Button>
        </dd>
      </dl>
      {present && (
        <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
          <div>
            <label htmlFor={editorId} className="block text-xs font-medium">
              Editor
            </label>
            <NativeSelect
              id={editorId}
              className="w-auto min-w-32"
              value={editor}
              onChange={(event) => {
                const next = EDITORS.find((item) => item.cli === event.target.value)?.cli;
                if (!next) return;
                setEditor(next);
                try {
                  window.localStorage.setItem(EDITOR_KEY, next);
                } catch {
                  /* Storage may be unavailable; the choice still applies to this page. */
                }
              }}
            >
              {EDITORS.map((item) => (
                <option key={item.cli} value={item.cli}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void copy("open", "Open command", command, commandRef.current)}
          >
            {copiedKey === "open" ? "Copied" : "Copy open command"}
          </Button>
          <code ref={commandRef} className="break-all text-xs text-muted-foreground">
            {command}
          </code>
        </div>
      )}
      {!inProject && !workspace.setupConfigured && present && (
        <p id={setupNoteId} className="mt-3 text-xs text-muted-foreground">
          No setup command is configured, so dependencies may be missing in the worktree. Add one in
          Setup.
        </p>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer">Commits ({workspace.commits.length})</summary>
        {workspace.commits.length ? (
          <ol className="mt-2 space-y-1">
            {workspace.commits.map((item) => (
              <li key={item.sha} className="flex gap-2">
                <code className="text-xs">{item.sha.slice(0, 7)}</code>
                <span>{item.subject}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-muted-foreground">No commits on the run branch yet.</p>
        )}
      </details>
      <div className="mt-4 flex flex-wrap items-start gap-3">
        {inProject && !workspace.promotion && branch === workspace.defaultBranchName ? (
          <p className="text-sm text-muted-foreground">
            The run branch already carries the ticket name, so there is nothing to promote.
          </p>
        ) : workspace.promotion ? (
          <p ref={promotionRef} tabIndex={-1} className="text-sm">
            Ticket branch <strong className="font-mono">{workspace.promotion.branch}</strong> at{" "}
            <code>{workspace.promotion.commit.slice(0, 7)}</code>
          </p>
        ) : (
          <div>
            <Button
              ref={promoteTrigger}
              disabled={Boolean(blocker) || !connected || busy}
              aria-describedby={blocker ? promoteHelpId : undefined}
              onClick={() => {
                setPromoteOpenings((count) => count + 1);
                setPromoteOpen(true);
              }}
            >
              Create ticket branch
            </Button>
            {blocker && (
              <p id={promoteHelpId} className="mt-1 text-xs text-muted-foreground">
                {blocker}
              </p>
            )}
          </div>
        )}
        {inProject && checkout?.onRunBranch && (
          <div>
            <Button
              variant="outline"
              disabled={Boolean(checkout.returnBlocker) || !connected || busy || returning}
              aria-describedby={checkout.returnBlocker || returnError ? returnHelpId : undefined}
              onClick={() => {
                setReturning(true);
                setReturnError("");
                void onReturn().then((error) => {
                  setReturning(false);
                  if (error) setReturnError(error);
                  else {
                    setMessage(`Switched the project back to ${previous}.`);
                    // The button unmounts once the checkout leaves the run branch.
                    headingRef.current?.focus();
                  }
                });
              }}
            >
              {returning ? "Switching…" : `Back to ${previous}`}
            </Button>
            {(returnError || checkout.returnBlocker) && (
              <p
                id={returnHelpId}
                role={returnError ? "alert" : undefined}
                className={`mt-1 text-xs ${returnError ? "text-red-700" : "text-muted-foreground"}`}
              >
                {returnError || checkout.returnBlocker}
              </p>
            )}
          </div>
        )}
        {!inProject && present && (
          <div>
            <Button
              ref={removeTrigger}
              variant="outline"
              disabled={!connected || busy}
              aria-describedby={workspace.removalBlocked ? removeHelpId : undefined}
              onClick={() => {
                setRemoveError("");
                setRemoveOpen(true);
              }}
            >
              Remove worktree…
            </Button>
            {workspace.removalBlocked && (
              <p id={removeHelpId} className="mt-1 text-xs text-muted-foreground">
                {REMOVAL_DIRTY}
              </p>
            )}
          </div>
        )}
      </div>
      {warning && <p className="mt-3 text-sm text-amber-800">{warning}</p>}
      <PromoteRunDialog
        key={promoteOpenings}
        open={promoteOpen}
        defaultName={workspace.defaultBranchName}
        runBranch={branch}
        onOpenChange={setPromoteOpen}
        returnFocus={() =>
          firstConnected(promoteTrigger.current, promotionRef.current, headingRef.current)
        }
        onSubmit={async (name) => {
          const result = await onPromote(name);
          if ("error" in result) return result;
          setPromoteOpen(false);
          setWarning(result.warning ?? "");
          setMessage(`Created branch ${name}.${result.warning ? ` ${result.warning}` : ""}`);
          return null;
        }}
      />
      <Dialog open={removeOpen} onOpenChange={(open) => !removing && setRemoveOpen(open)}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            firstConnected(
              removeTrigger.current,
              copyBranchRef.current,
              headingRef.current,
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
          {removeError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {removeError}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" disabled={removing} onClick={() => setRemoveOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={removing}
              onClick={() => {
                setRemoving(true);
                void onRemove().then((error) => {
                  setRemoving(false);
                  if (error) setRemoveError(error);
                  else {
                    setRemoveOpen(false);
                    setMessage("Worktree removed. Branches are kept.");
                  }
                });
              }}
            >
              {removing ? "Removing…" : "Remove worktree"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
};
