import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RunRecord } from "../domain/run.js";
import type { Evidence } from "../domain/evidence.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  definitionForScope,
  scopeEvidence,
  stepForScope,
  validScope,
  type RunScope,
} from "./run-view-model";

type Tab = "Activity" | "Files" | "Artifacts" | "Details";
const tabs: Tab[] = ["Activity", "Files", "Artifacts", "Details"];
type Filter = "All" | "Messages" | "Tools" | "Checks" | "Errors";
const filters: Filter[] = ["All", "Messages", "Tools", "Checks", "Errors"];
const matchesFilter = (item: Extract<Evidence, { kind: "event" }>, filter: Filter): boolean =>
  filter === "All" ||
  (filter === "Messages" && ["message", "lifecycle", "guidance"].includes(item.type)) ||
  (filter === "Tools" && item.type === "tool") ||
  (filter === "Checks" && item.type === "check") ||
  (filter === "Errors" && item.type === "error");

const Details = ({ run, scope }: { run: RunRecord; scope: RunScope }) => {
  const definition = definitionForScope(run, scope);
  const step = stepForScope(run, scope);
  const attempt = step?.attempts.find(
    (item) => item.id === (scope.kind === "step" ? scope.attemptId : ""),
  );
  const receipts = scopeEvidence(run, scope).filter((item) => "provenance" in item);
  return (
    <div className="space-y-4 p-4 text-sm">
      {definition ? (
        <>
          <section className="rounded-lg border bg-muted/30 p-3">
            <h4 className="font-semibold">Instructions · {definition.name}</h4>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
              {definition.instruction}
            </p>
          </section>
          <dl className="run-details-grid">
            <dt>Role</dt>
            <dd>{definition.role}</dd>
            <dt>Kind</dt>
            <dd>{definition.kind}</dd>
            <dt>Agent / model</dt>
            <dd>
              {run.snapshot.bindings[definition.id]?.provider ?? "Unassigned"} ·{" "}
              {run.snapshot.bindings[definition.id]?.model ?? "Unassigned"}
              {run.snapshot.bindings[definition.id]?.effort
                ? ` · ${run.snapshot.bindings[definition.id]?.effort}`
                : ""}
            </dd>
            <dt>Attempt</dt>
            <dd>{attempt ? `${attempt.number} · ${attempt.status}` : "No attempt selected"}</dd>
            <dt>Step status</dt>
            <dd>{step?.status ?? "Unknown"}</dd>
            <dt>Dependencies</dt>
            <dd>
              {run.snapshot.loop.dependencies
                .filter((edge) => edge.to === definition.id)
                .map((edge) => edge.from)
                .join(", ") || "None"}
            </dd>
            <dt>Expected outputs</dt>
            <dd>{definition.expectedOutputs.join(", ") || "None declared"}</dd>
            <dt>Candidate</dt>
            <dd className="break-all">{step?.candidateId ?? "None yet"}</dd>
            <dt>Input hash</dt>
            <dd className="break-all">{step?.inputHash ?? "None yet"}</dd>
          </dl>
        </>
      ) : (
        <section className="rounded-lg border bg-muted/30 p-3">
          <h4 className="font-semibold">Run snapshot</h4>
          <p className="mt-2 whitespace-pre-wrap">{run.snapshot.task.description}</p>
        </section>
      )}
      <dl className="run-details-grid">
        <dt>Loop snapshot</dt>
        <dd>
          {run.snapshot.loop.name} v{run.snapshot.loop.version}
        </dd>
        <dt>Baseline</dt>
        <dd className="break-all">{run.snapshot.baseline.revision ?? run.snapshot.baseline.id}</dd>
        <dt>Source revision</dt>
        <dd className="break-all">{run.snapshot.baseline.sourceRevision ?? "Not recorded"}</dd>
        <dt>Workspace</dt>
        <dd className="break-all">{run.snapshot.baseline.workspace ?? "Not recorded"}</dd>
        <dt>Task source</dt>
        <dd>
          {run.snapshot.task.ticket
            ? `${run.snapshot.task.ticket.id} · ${run.snapshot.task.ticket.title}`
            : "Description only"}
        </dd>
        <dt>Captured</dt>
        <dd>{new Date(run.snapshot.baseline.capturedAt).toLocaleString()}</dd>
        <dt>Implementation round</dt>
        <dd>{run.implementationRound}</dd>
      </dl>
      {receipts.length > 0 && (
        <section>
          <h4 className="font-semibold">Evidence provenance</h4>
          <ul className="mt-2 space-y-2">
            {receipts.map((item) => (
              <li key={item.id} className="rounded-md border p-2 text-xs">
                <strong>{item.kind}</strong> · {item.provenance.source} · {item.freshness.state}
                <div className="mt-1 break-all text-muted-foreground">
                  Candidate {item.provenance.candidateId} · inputs{" "}
                  {item.provenance.inputReceiptIds.join(", ") || "none"}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

const Activity = ({
  run,
  scope,
  connected,
}: {
  run: RunRecord;
  scope: RunScope;
  connected: boolean;
}) => {
  const [filter, setFilter] = useState<Filter>("All");
  const [search, setSearch] = useState("");
  const [followLive, setFollowLive] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const scrollPositions = useRef(new Map<string, number>());
  const scroller = useRef<HTMLOListElement>(null);
  const key =
    scope.kind === "run" ? `run:${run.snapshot.id}` : `${scope.stepId}:${scope.attemptId ?? "all"}`;
  const events = scopeEvidence(run, scope)
    .filter((item): item is Extract<Evidence, { kind: "event" }> => item.kind === "event")
    .filter(
      (item) =>
        matchesFilter(item, filter) &&
        `${item.title} ${item.detail ?? ""}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((left, right) => left.sequence - right.sequence);
  const lastSequence = events.at(-1)?.sequence ?? -1;
  const previous = useRef({ key, lastSequence });
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = scrollPositions.current.get(key) ?? 0;
    setNewCount(0);
  }, [key]);
  useEffect(() => {
    const prior = previous.current;
    previous.current = { key, lastSequence };
    if (prior.key !== key || lastSequence <= prior.lastSequence) return;
    if (followLive) {
      const element = scroller.current;
      if (element) element.scrollTop = element.scrollHeight;
    } else
      setNewCount(
        (value) => value + events.filter((event) => event.sequence > prior.lastSequence).length,
      );
  }, [key, lastSequence, followLive, events]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b p-3">
        <Input
          aria-label="Search activity"
          placeholder="Search activity"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <fieldset className="flex flex-wrap gap-1">
          <legend className="sr-only">Activity filters</legend>
          {filters.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={filter === item ? "secondary" : "ghost"}
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {item}
            </Button>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={followLive}
            onChange={(event) => {
              setFollowLive(event.target.checked);
              if (event.target.checked) {
                setNewCount(0);
                const element = scroller.current;
                if (element) element.scrollTop = element.scrollHeight;
              }
            }}
          />
          Follow live
        </label>
        <p className="text-xs text-muted-foreground">
          {connected ? "Runtime reachable" : "Disconnected · execution state unknown"}
        </p>
      </div>
      <ol
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto p-4"
        aria-label="Activity events"
        onScroll={(event) => scrollPositions.current.set(key, event.currentTarget.scrollTop)}
      >
        {events.map((item) => (
          <li key={item.id} className="border-b py-3 text-sm last:border-b-0">
            <div className="flex items-center justify-between gap-2">
              <span className={`run-status run-status-${item.type}`}>{item.type}</span>
              <time className="text-xs text-muted-foreground" dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString()}
              </time>
            </div>
            <strong className="mt-1 block">{item.title}</strong>
            {item.detail && (
              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {item.detail}
              </p>
            )}
          </li>
        ))}
        {!events.length && (
          <li className="p-6 text-center text-sm text-muted-foreground">
            No matching activity. A quiet stream does not mean the step failed.
          </li>
        )}
      </ol>
      {newCount > 0 && !followLive && (
        <Button
          variant="outline"
          size="sm"
          className="m-3"
          onClick={() => {
            const element = scroller.current;
            if (element) {
              element.scrollTop = element.scrollHeight;
              scrollPositions.current.set(key, element.scrollTop);
            }
            setNewCount(0);
          }}
        >
          {newCount} new events · Jump to latest
        </Button>
      )}
    </div>
  );
};

export const RunInspector = ({
  run,
  scope: requestedScope,
  onScopeChange,
  onClose,
  connected,
  initialTab = "Activity",
}: {
  run: RunRecord;
  scope: RunScope;
  onScopeChange: (scope: RunScope) => void;
  onClose: () => void;
  connected: boolean;
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
          <Activity run={run} scope={scope} connected={connected} />
        ) : tab === "Details" ? (
          <Details run={run} scope={scope} />
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
    </aside>
  );
};
