import { Button } from "@/shared/components/button";

export const RunUpdatesBar = ({
  connected,
  onInspect,
}: {
  connected: boolean;
  onInspect: () => void;
}) => (
  <div className="flex items-center justify-between rounded-lg border bg-white p-3 text-xs">
    <span>{connected ? "Receiving run updates" : "Reconnecting to runtime…"}</span>
    <Button variant="ghost" size="sm" onClick={onInspect}>
      Inspect run evidence
    </Button>
  </div>
);
