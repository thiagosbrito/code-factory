import { useRef, useState } from "react";
import type { RunRecord } from "../domain/run.js";
import type { AgentConnection } from "../adapters/contract.js";
import { Button } from "@/components/ui/button";
import { RunGraph } from "./RunGraph";
import { RunInspector } from "./RunInspector";
import { runStatus, runTitle, type RunScope } from "./run-view-model";

export const RunDetail = ({
  run,
  connected,
  streamConnected,
  executing,
  onExecute,
  onCancel,
  onBack,
  agents = [],
  onSendGuidance = async () => undefined,
}: {
  run: RunRecord;
  connected: boolean;
  streamConnected?: boolean | null;
  executing: boolean;
  onExecute: () => void;
  onCancel: () => void;
  onBack: () => void;
  agents?: AgentConnection[];
  onSendGuidance?: (input: { stepId: string; attemptId: string; message: string }) => Promise<void>;
}) => {
  const [scope, setScope] = useState<RunScope | null>(null);
  const [initialTab, setInitialTab] = useState<"Activity" | "Files" | "Artifacts">("Activity");
  const trigger = useRef<HTMLElement | null>(null);
  const open = (next: RunScope, tab: "Activity" | "Files" | "Artifacts" = "Activity") => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setInitialTab(tab);
    setScope(next);
  };
  const close = () => {
    setScope(null);
    window.requestAnimationFrame(() => trigger.current?.focus());
  };
  const active = run.steps.filter((step) => step.status === "running").length;
  const complete = run.steps.filter((step) => step.status === "succeeded").length;
  const files = run.evidence.filter((item) => item.kind === "file").length;
  const artifacts = run.evidence.filter((item) => item.kind === "artifact").length;
  const checks = run.evidence.filter((item) => item.kind === "check");
  return (
    <div className="mt-7 space-y-5">
      <Button variant="outline" size="sm" onClick={onBack}>
        ← All runs
      </Button>
      <header className="rounded-lg border bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          {run.snapshot.task.ticket?.id ?? "Description only"} · Run {run.snapshot.id}
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">{runTitle(run)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {run.snapshot.loop.name} v{run.snapshot.loop.version} · round{" "}
              {run.implementationRound}
            </p>
          </div>
          <div className="flex gap-2">
            {run.status === "pending" && (
              <Button disabled={executing || !connected} onClick={onExecute}>
                {executing ? "Executing…" : "Execute run"}
              </Button>
            )}
            {(executing || run.status === "running") && connected && (
              <Button variant="outline" onClick={onCancel}>
                Cancel run
              </Button>
            )}
          </div>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm">{run.snapshot.task.description}</p>
        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          <span className={`run-status run-status-${run.status}`}>{runStatus(run)}</span>
          <span>{active} active steps</span>
          <span>
            {complete} of {run.steps.length} complete
          </span>
          <span
            className={connected && streamConnected !== false ? "text-emerald-700" : "text-red-700"}
          >
            {!connected
              ? "Disconnected · work state unknown"
              : streamConnected === false
                ? "Event stream reconnecting · runtime reachable"
                : streamConnected === true
                  ? "Live event stream"
                  : "Runtime reachable · polling"}
          </span>
        </div>
      </header>
      <section className="grid gap-2 sm:grid-cols-4" aria-label="Run summary">
        <Button
          variant="outline"
          className="h-auto justify-between bg-white p-4"
          onClick={() => open({ kind: "run" }, "Files")}
        >
          Changed files <strong>{files}</strong>
        </Button>
        <Button
          variant="outline"
          className="h-auto justify-between bg-white p-4"
          onClick={() => open({ kind: "run" }, "Artifacts")}
        >
          Artifacts <strong>{artifacts}</strong>
        </Button>
        <div className="rounded-md border bg-white p-4 text-sm">
          Checks <strong className="float-right">{checks.length}</strong>
        </div>
        <div className="rounded-md border bg-white p-4 text-sm">
          Loop progress{" "}
          <strong className="float-right">
            {complete}/{run.steps.length}
          </strong>
        </div>
      </section>
      <RunGraph
        run={run}
        selectedStepId={scope?.kind === "step" ? scope.stepId : null}
        onSelect={(stepId) => {
          const step = run.steps.find((item) => item.stepId === stepId);
          open({ kind: "step", stepId, attemptId: step?.attempts.at(-1)?.id ?? null });
        }}
      />
      <div className="flex items-center justify-between rounded-lg border bg-white p-3 text-xs">
        <span>{connected ? "Receiving run updates" : "Reconnecting to runtime…"}</span>
        <Button variant="ghost" size="sm" onClick={() => open({ kind: "run" })}>
          Inspect run evidence
        </Button>
      </div>
      {scope && (
        <RunInspector
          run={run}
          scope={scope}
          onScopeChange={setScope}
          onClose={close}
          connected={connected}
          agents={agents}
          onSendGuidance={onSendGuidance}
          initialTab={initialTab}
        />
      )}
    </div>
  );
};
