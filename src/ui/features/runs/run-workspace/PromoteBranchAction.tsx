import { useId, useRef, useState, type RefObject } from "react";
import type { EvidenceSummary } from "../../../../domain/acceptance.js";
import { promotionBlocker, type RunWorkspace } from "../../../../domain/run-branch.js";
import { Button } from "@/shared/components/button";
import { PromoteRunDialog, type PromoteFailure } from "../PromoteRunDialog";
import { firstConnected } from "./focus";

/** What the run branch offers for promotion: nothing to do, the created branch, or the button. */
export const PromoteBranchAction = ({
  workspace,
  summary,
  inProject,
  branch,
  connected,
  busy,
  headingRef,
  onPromote,
  onPromoted,
}: {
  workspace: RunWorkspace;
  summary: EvidenceSummary | null;
  inProject: boolean;
  branch: string;
  connected: boolean;
  busy: boolean;
  headingRef: RefObject<HTMLElement | null>;
  onPromote: (name: string) => Promise<PromoteFailure | { warning?: string }>;
  /** Called once a ticket branch exists, with its name and any warning to show. */
  onPromoted: (name: string, warning: string | undefined) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [openings, setOpenings] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const promotionRef = useRef<HTMLParagraphElement>(null);
  const helpId = useId();
  const blocker = summary
    ? promotionBlocker(summary, workspace)
    : "Accept the evidence before creating a ticket branch.";
  return (
    <>
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
            ref={trigger}
            disabled={Boolean(blocker) || !connected || busy}
            aria-describedby={blocker ? helpId : undefined}
            onClick={() => {
              setOpenings((count) => count + 1);
              setOpen(true);
            }}
          >
            Create ticket branch
          </Button>
          {blocker && (
            <p id={helpId} className="mt-1 text-xs text-muted-foreground">
              {blocker}
            </p>
          )}
        </div>
      )}
      <PromoteRunDialog
        key={openings}
        open={open}
        defaultName={workspace.defaultBranchName}
        runBranch={branch}
        onOpenChange={setOpen}
        returnFocus={() =>
          firstConnected(trigger.current, promotionRef.current, headingRef.current)
        }
        onSubmit={async (name) => {
          const result = await onPromote(name);
          if ("error" in result) return result;
          setOpen(false);
          onPromoted(name, result.warning);
          return null;
        }}
      />
    </>
  );
};
