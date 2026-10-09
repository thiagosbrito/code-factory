import { useId, useRef, useState } from "react";
import type { EvidenceSummary } from "../../../domain/acceptance.js";
import type { RunWorkspace } from "../../../domain/run-branch.js";
import { useCopyAnnouncer } from "../../shared/clipboard";
import type { PromoteFailure } from "./PromoteRunDialog";
import { EditorOpener } from "./run-workspace/EditorOpener";
import { PromoteBranchAction } from "./run-workspace/PromoteBranchAction";
import { RemoveWorktreeAction } from "./run-workspace/RemoveWorktreeAction";
import { ReturnToBranchAction } from "./run-workspace/ReturnToBranchAction";
import { WorkspaceCommits } from "./run-workspace/WorkspaceCommits";
import { WorkspaceLocation } from "./run-workspace/WorkspaceLocation";
import { saveEditor, storedEditor, type EditorCli } from "./run-workspace/workspace-editor";

export { EDITORS, openInEditorCommand } from "./run-workspace/workspace-editor";

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
  bare = false,
}: {
  workspace: RunWorkspace;
  summary: EvidenceSummary | null;
  connected: boolean;
  busy: boolean;
  onPromote: (name: string) => Promise<PromoteFailure | { warning?: string }>;
  onRemove: () => Promise<string | null>;
  onReturn: () => Promise<string | null>;
  /** Inside a dialog: no card border or padding of its own. */
  bare?: boolean;
}) => {
  const { message, setMessage, copiedKey, copy } = useCopyAnnouncer();
  const [editor, setEditor] = useState<EditorCli>(storedEditor);
  const [warning, setWarning] = useState("");
  const branchRef = useRef<HTMLElement>(null);
  const pathRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const copyBranchRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const setupNoteId = useId();
  if (workspace.kind !== "worktree" && workspace.kind !== "project") return null;
  const inProject = workspace.kind === "project";
  const checkout = workspace.checkout;
  const previous = checkout
    ? (checkout.previousBranch ?? `${checkout.previousRevision.slice(0, 7)} (detached)`)
    : "";
  const present = workspace.state === "present";
  const branch = workspace.branch ?? "";
  const path = workspace.path ?? "";
  return (
    <section
      aria-labelledby={headingId}
      className={bare ? "bg-white" : "rounded-lg border bg-white p-5"}
    >
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
      <WorkspaceLocation
        branch={branch}
        path={path}
        inProject={inProject}
        copiedKey={copiedKey}
        copy={copy}
        branchRef={branchRef}
        pathRef={pathRef}
        copyBranchRef={copyBranchRef}
      />
      {present && (
        <EditorOpener
          editor={editor}
          path={path}
          copiedKey={copiedKey}
          copy={copy}
          onEditorChange={(next) => {
            setEditor(next);
            saveEditor(next);
          }}
        />
      )}
      {!inProject && !workspace.setupConfigured && present && (
        <p id={setupNoteId} className="mt-3 text-xs text-muted-foreground">
          No setup command is configured, so dependencies may be missing in the worktree. Add one in
          Setup.
        </p>
      )}
      <WorkspaceCommits commits={workspace.commits} />
      <div className="mt-4 flex flex-wrap items-start gap-3">
        <PromoteBranchAction
          workspace={workspace}
          summary={summary}
          inProject={inProject}
          branch={branch}
          connected={connected}
          busy={busy}
          headingRef={headingRef}
          onPromote={onPromote}
          onPromoted={(name, warned) => {
            setWarning(warned ?? "");
            setMessage(`Created branch ${name}.${warned ? ` ${warned}` : ""}`);
          }}
        />
        {inProject && checkout?.onRunBranch && (
          <ReturnToBranchAction
            checkout={checkout}
            previous={previous}
            connected={connected}
            busy={busy}
            headingRef={headingRef}
            onReturn={onReturn}
            announce={setMessage}
          />
        )}
        <RemoveWorktreeAction
          workspace={workspace}
          branch={branch}
          showTrigger={!inProject && present}
          connected={connected}
          busy={busy}
          fallbackTargets={[copyBranchRef, headingRef]}
          onRemove={onRemove}
          announce={setMessage}
        />
      </div>
      {warning && <p className="mt-3 text-sm text-amber-800">{warning}</p>}
    </section>
  );
};
