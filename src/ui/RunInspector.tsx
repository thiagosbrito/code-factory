import { useEffect, useRef, useState } from "react";
import type { RunRecord } from "../domain/run.js";
import type { AgentConnection } from "../adapters/contract.js";
import type { Evidence } from "../domain/evidence.js";
import { Button } from "@/components/ui/button";
import {
  definitionForScope,
  scopeEvidence,
  stepForScope,
  validScope,
  type RunScope,
} from "./run-view-model";
import { RunInspectorActivity } from "./RunInspectorActivity";
import { RunInspectorDetails } from "./RunInspectorDetails";
import { RunGuidance } from "./RunGuidance";

type Tab = "Activity" | "Files" | "Artifacts" | "Details";
const tabs: Tab[] = ["Activity", "Files", "Artifacts", "Details"];

export const RunInspector = ({
  run,
  scope: requestedScope,
  onScopeChange,
  onClose,
  connected,
  agents = [],
  onSendGuidance = async () => undefined,
  initialTab = "Activity",
}: {
  run: RunRecord;
  scope: RunScope;
  onScopeChange: (scope: RunScope) => void;
  onClose: () => void;
  connected: boolean;
  agents?: AgentConnection[];
  onSendGuidance?: (input: { stepId: string; attemptId: string; message: string }) => Promise<void>;
  initialTab?: Tab;
}) => {
  const scope = validScope(run, requestedScope);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [width, setWidth] = useState(520);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drag = useRef(false);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  useEffect(() => {
    if (scope === requestedScope) return;
    onScopeChange(scope);
  }, [scope, requestedScope, onScopeChange]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (drag.current)
        setWidth(
          Math.max(
            360,
            Math.min(
              window.innerWidth * 0.75,
              event.clientX - (window.innerWidth >= 768 ? 232 : 0),
            ),
          ),
        );
    };
    const stop = () => {
      drag.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, []);
  const step = stepForScope(run, scope);
  const definition = definitionForScope(run, scope);
  const evidence = scopeEvidence(run, scope);
  const changeTab = (next: Tab) => setTab(next);
  const handleKeys = (event: React.KeyboardEvent) => {
    if (
      (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
      (event.target as HTMLElement).getAttribute("role") === "tab"
    ) {
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      if (next) {
        changeTab(next);
        document.getElementById(`run-inspector-tab-${next}`)?.focus();
      }
    }
  };
  return (
    <aside
      className="run-inspector fixed bottom-0 left-0 top-0 z-40 flex max-w-[100vw] flex-col border-r bg-white shadow-xl md:left-[232px]"
      style={{ width }}
      aria-label="Run inspector"
    >
      <input
        type="range"
        aria-label="Resize inspector"
        aria-orientation="vertical"
        min={360}
        max={Math.round(window.innerWidth * 0.75)}
        value={width}
        onChange={(event) => setWidth(Number(event.target.value))}
        className="absolute bottom-0 right-0 top-0 z-10 w-2 cursor-ew-resize hover:bg-primary/20"
        onPointerDown={(event) => {
          drag.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight")
            setWidth((value) => Math.min(value + 24, window.innerWidth * 0.75));
          if (event.key === "ArrowLeft") setWidth((value) => Math.max(360, value - 24));
        }}
      />
      <header className="border-b p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {scope.kind === "run"
            ? "Run scope"
            : `Step · ${scope.stepId} · ${scope.attemptId ? `Attempt ${step?.attempts.find((item) => item.id === scope.attemptId)?.number ?? "?"}` : "All attempts"}`}
        </p>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{definition?.name ?? "Run evidence"}</h2>
            <p className="text-xs text-muted-foreground">
              {scope.kind === "run"
                ? run.snapshot.id
                : `${definition?.role ?? "Step"} · ${step?.status ?? "unknown"}`}
            </p>
          </div>
          <Button
            ref={closeRef}
            size="sm"
            variant="outline"
            onClick={onClose}
            aria-label="Close inspector"
          >
            Close
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            variant={scope.kind === "run" ? "secondary" : "ghost"}
            onClick={() => onScopeChange({ kind: "run" })}
          >
            Run scope
          </Button>
          {step && (
            <select
              className="rounded-md border bg-white px-2 py-1 text-xs"
              aria-label="Selected attempt"
              value={scope.kind === "step" ? (scope.attemptId ?? "") : ""}
              onChange={(event) =>
                onScopeChange({
                  kind: "step",
                  stepId: step.stepId,
                  attemptId: event.target.value || null,
                })
              }
            >
              <option value="">All attempts</option>
              {step.attempts.map((item) => (
                <option key={item.id} value={item.id}>
                  Attempt {item.number} · {item.status}
                </option>
              ))}
            </select>
          )}
        </div>
        <div
          role="tablist"
          aria-label="Inspector tabs"
          tabIndex={-1}
          className="mt-4 flex gap-1"
          onKeyDown={handleKeys}
        >
          {tabs.map((item) => (
            <button
              key={item}
              id={`run-inspector-tab-${item}`}
              role="tab"
              aria-selected={tab === item}
              tabIndex={tab === item ? 0 : -1}
              className={`border-b-2 px-2 py-2 text-xs font-semibold ${tab === item ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
              onClick={() => changeTab(item)}
            >
              {item}
              {item === "Files" || item === "Artifacts"
                ? ` (${evidence.filter((entry) => entry.kind === (item === "Files" ? "file" : "artifact")).length})`
                : ""}
            </button>
          ))}
        </div>
      </header>
      <div
        role="tabpanel"
        aria-labelledby={`run-inspector-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col overflow-auto"
      >
        {tab === "Activity" ? (
          <RunInspectorActivity run={run} scope={scope} connected={connected} />
        ) : tab === "Details" ? (
          <RunInspectorDetails run={run} scope={scope} />
        ) : (
          <ul className="space-y-2 p-4">
            {evidence
              .filter(
                (item): item is Extract<Evidence, { kind: "file" | "artifact" }> =>
                  item.kind === (tab === "Files" ? "file" : "artifact"),
              )
              .map((item) => (
                <li key={item.id} className="rounded-md border p-3 text-sm">
                  <strong>
                    {item.kind === "file" ? item.path : item.kind === "artifact" ? item.name : ""}
                  </strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.kind === "file"
                      ? `${item.change} · +${item.additions} −${item.deletions}`
                      : item.kind === "artifact"
                        ? item.mediaType
                        : ""}{" "}
                    · {item.freshness.state}
                  </p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {item.kind === "file" || item.kind === "artifact"
                      ? `Candidate ${item.provenance.candidateId}`
                      : ""}
                  </p>
                </li>
              ))}
            {!evidence.some((item) => item.kind === (tab === "Files" ? "file" : "artifact")) && (
              <li className="p-6 text-center text-sm text-muted-foreground">
                No {tab.toLowerCase()} recorded for this scope.
              </li>
            )}
          </ul>
        )}
      </div>
      <div hidden={tab !== "Activity"}>
        <RunGuidance
          run={run}
          scope={scope}
          connected={connected}
          agents={agents}
          onSend={onSendGuidance}
        />
      </div>
    </aside>
  );
};
