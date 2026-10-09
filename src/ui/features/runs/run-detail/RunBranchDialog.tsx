import type { ComponentProps } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/dialog";
import { RunWorkspacePanel } from "../RunWorkspacePanel";

export const RunBranchDialog = ({
  open,
  onClose,
  onCloseAutoFocus,
  ...workspacePanel
}: {
  open: boolean;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
} & Omit<ComponentProps<typeof RunWorkspacePanel>, "bare">) => (
  <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
    <DialogContent className="w-[min(95vw,820px)]" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogTitle className="sr-only">Run branch</DialogTitle>
      <DialogDescription className="sr-only">
        Branch, project checkout, commits and branch actions for this run.
      </DialogDescription>
      <RunWorkspacePanel bare {...workspacePanel} />
    </DialogContent>
  </Dialog>
);
