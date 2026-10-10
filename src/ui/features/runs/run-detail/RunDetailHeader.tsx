import type { RefObject } from "react";
import type { EvidenceSummary } from "../../../../domain/acceptance.js";
import type { RunRecord } from "../../../../domain/run.js";
import { Button } from "@/shared/components/button";
import { EvidenceStatusText } from "./EvidenceStatusText";
import { RunConnectionStatus } from "./RunConnectionStatus";
import { runStatusLabel, runTitle, stepProgress, type RunStep } from "../run-view-model";

export const RunDetailHeader = ({
  run,
  summary,
  branch,
  connectionStep,
  acceptable,
  accepting,
  connected,
  streamConnected,
  titleRef,
  onAccept,
  onBack,
}: {
  run: RunRecord;
  summary: EvidenceSummary | null;
  /** The run branch name, when the run has a workspace. */
  branch?: string | null | undefined;
  connectionStep: RunStep | undefined;
  acceptable: boolean;
  accepting: boolean;
  connected: boolean;
  streamConnected?: boolean | null | undefined;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onAccept: () => void;
  onBack: () => void;
}) => {
  const { active, complete } = stepProgress(run);
  return (
    <header className="sticky top-0 z-20 -mx-2 rounded-lg border bg-card/95 px-4 py-3 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          ← All runs
        </Button>
        <div className="min-w-0 flex-1">
          <h2
            ref={titleRef}
            tabIndex={-1}
            className="truncate text-lg font-semibold"
            title={runTitle(run)}
          >
            {runTitle(run)}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wide text-primary">
              {run.snapshot.task.ticket?.id ?? run.snapshot.task.ticketId ?? "Description only"}
            </span>{" "}
            · {run.snapshot.loop.name} v{run.snapshot.loop.version} · round{" "}
            {run.implementationRound} · Run {run.snapshot.id}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {acceptable && (
            <Button disabled={!connected || accepting} onClick={onAccept}>
              {accepting ? "Recording acceptance…" : "Accept evidence"}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <span className={`run-status run-status-${run.status}`}>
          {runStatusLabel(run, connectionStep)}
        </span>
        <span>{active} active steps</span>
        <span>
          {complete} of {run.steps.length} complete
        </span>
        <span>
          <EvidenceStatusText summary={summary} />
        </span>
        {branch && <span className="font-mono text-muted-foreground">{branch}</span>}
        <RunConnectionStatus connected={connected} streamConnected={streamConnected} />
      </div>
    </header>
  );
};
