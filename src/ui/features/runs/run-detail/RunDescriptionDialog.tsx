import type { RunRecord } from "../../../../domain/run.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/dialog";
import { Markdown } from "../../../shared/Markdown";

export const RunDescriptionDialog = ({
  run,
  open,
  onClose,
  onCloseAutoFocus,
}: {
  run: RunRecord;
  open: boolean;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) => {
  const { ticket, ticketId, description } = run.snapshot.task;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle className="text-xl font-semibold">Description</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {ticket
            ? `${ticket.id} · ${ticket.title}`
            : ticketId
              ? `Ticket ${ticketId}, read by the agent through its tracker MCP`
              : "Description-only run"}
        </DialogDescription>
        {ticket?.summary && <Markdown className="mt-4">{ticket.summary}</Markdown>}
        {description && <Markdown className="mt-4">{description}</Markdown>}
      </DialogContent>
    </Dialog>
  );
};
