import type { ReactNode } from "react";
import type { RunRecord } from "../../domain/run.js";
import { Card } from "@/shared/components/card";
import { RunsList } from "../features/runs/RunsList";
import type { FactoryRuns } from "../features/runs/useFactoryRuns";
import type { FactoryResponse } from "../shared/project-api";
import { FactoryEmptyState } from "./FactoryEmptyState";
import { RunHistoryState } from "./RunHistoryState";

export type RunsScreenState = Pick<
  FactoryRuns,
  | "selectedRun"
  | "selectedRunId"
  | "setSelectedRunId"
  | "historyState"
  | "historyError"
  | "connected"
  | "runs"
  | "reload"
  | "openRun"
>;

/** The runs screen: the selected run, the history list, or the state that explains why not. */
export const RunsScreen = ({
  factory,
  counts,
  renderSelected,
  onCreate,
  onTemplate,
}: {
  factory: RunsScreenState;
  counts: FactoryResponse;
  /** The detail view of the selected run; `onBack` returns to the history list. */
  renderSelected: (run: RunRecord, onBack: () => void) => ReactNode;
  onCreate: () => void;
  onTemplate: () => void;
}) => {
  const { selectedRun, selectedRunId, historyState, historyError, connected, runs, reload } =
    factory;
  const allRuns = () => {
    factory.setSelectedRunId("");
    window.history.pushState(null, "", "#runs");
  };
  const state = (kind: Parameters<typeof RunHistoryState>[0]["kind"]) => (
    <RunHistoryState kind={kind} error={historyError} onReload={reload} onAllRuns={allRuns} />
  );
  if (selectedRun) return renderSelected(selectedRun, allRuns);
  if (historyState === "loading") return state("loading");
  if (historyState === "error") return state("error");
  if (selectedRunId) return state(connected ? "loading-selected" : "unavailable");
  if (runs.length > 0)
    return (
      <>
        <p className="mt-5 text-xs text-muted-foreground">
          {connected ? "Local runtime connected" : "Disconnected · saved history may be stale"}
        </p>
        <RunsList runs={runs} onOpen={factory.openRun} />
      </>
    );
  if (!connected) return state("disconnected");
  if (counts.runs === 0)
    return <FactoryEmptyState kind="runs" onCreate={onCreate} onTemplate={onTemplate} />;
  return (
    <Card className="mt-7 p-6">
      <h2 className="font-semibold">{counts.runs} saved runs</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Saved items will be listed when the runs view is connected.
      </p>
    </Card>
  );
};
