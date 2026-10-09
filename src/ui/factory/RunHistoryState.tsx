import { Button } from "@/shared/components/button";
import { Card } from "@/shared/components/card";

export type RunHistoryKind =
  | "loading"
  | "error"
  | "loading-selected"
  | "unavailable"
  | "disconnected";

/** The runs screen when there is no run list or detail to show yet. */
export const RunHistoryState = ({
  kind,
  error,
  onReload,
  onAllRuns,
}: {
  kind: RunHistoryKind;
  error: string;
  onReload: () => void;
  onAllRuns: () => void;
}) => {
  switch (kind) {
    case "loading":
      return <output className="mt-7 block text-sm">Loading run history…</output>;
    case "loading-selected":
      return <output className="mt-7 block text-sm">Loading selected run…</output>;
    case "error":
      return (
        <Card className="mt-7 p-6" role="alert">
          <h2 className="font-semibold">Could not load run history</h2>
          <p className="mt-2 text-sm">{error}</p>
          <Button className="mt-4" onClick={onReload}>
            Retry
          </Button>
        </Card>
      );
    case "unavailable":
      return (
        <Card className="mt-7 p-6" role="alert">
          <h2 className="font-semibold">Run unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The selected run could not be loaded from the local runtime.
          </p>
          <Button className="mt-4 mr-2" onClick={onReload}>
            Reconnect
          </Button>
          <Button className="mt-4" variant="outline" onClick={onAllRuns}>
            All runs
          </Button>
        </Card>
      );
    case "disconnected":
      return (
        <Card className="mt-7 p-6" role="alert">
          <h2 className="font-semibold">Runtime disconnected</h2>
          <p className="mt-2 text-sm">
            Run history is unavailable until the local runtime reconnects.
          </p>
          <Button className="mt-4" onClick={onReload}>
            Reconnect
          </Button>
        </Card>
      );
  }
};
