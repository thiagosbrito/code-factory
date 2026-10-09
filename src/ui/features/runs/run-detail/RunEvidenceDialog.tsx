import type { EvidenceSummary } from "../../../../domain/acceptance.js";
import { Button } from "@/shared/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/dialog";
import { RunEvidenceSummary } from "../RunEvidenceSummary";
import { EvidenceStatusText } from "./EvidenceStatusText";

export const RunEvidenceDialog = ({
  summary,
  complete,
  total,
  open,
  acceptable,
  accepting,
  connected,
  onAccept,
  onClose,
  onCloseAutoFocus,
  onOpenFiles,
  onOpenArtifacts,
}: {
  summary: EvidenceSummary | null;
  complete: number;
  total: number;
  open: boolean;
  acceptable: boolean;
  accepting: boolean;
  connected: boolean;
  onAccept: () => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  onOpenFiles: () => void;
  onOpenArtifacts: () => void;
}) => (
  <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
    <DialogContent className="w-[min(95vw,960px)]" onCloseAutoFocus={onCloseAutoFocus}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <DialogTitle className="text-xl font-semibold">Final evidence summary</DialogTitle>
          <DialogDescription className="mt-1 text-sm">
            <EvidenceStatusText summary={summary} />
          </DialogDescription>
        </div>
        {acceptable && (
          <Button disabled={!connected || accepting} onClick={onAccept}>
            {accepting ? "Recording acceptance…" : "Accept evidence"}
          </Button>
        )}
      </div>
      <div className="mt-5">
        <RunEvidenceSummary
          summary={summary}
          complete={complete}
          total={total}
          onOpenFiles={onOpenFiles}
          onOpenArtifacts={onOpenArtifacts}
        />
      </div>
    </DialogContent>
  </Dialog>
);
