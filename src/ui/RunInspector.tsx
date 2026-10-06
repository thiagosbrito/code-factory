import { useEffect, useRef, useState } from "react";
import type { RunRecord } from "../domain/run.js";
import type { EvidenceSummary } from "../domain/acceptance.js";
import type { AgentConnection } from "../adapters/contract.js";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  definitionForScope,
  scopeEvidence,
  stepForScope,
  validScope,
  type RunScope,
} from "./run-view-model";
import { RunInspectorActivity } from "./RunInspectorActivity";
import { RunInspectorDetails } from "./RunInspectorDetails";
import { RunInspectorFiles } from "./RunInspectorFiles";
import { RunInspectorArtifacts } from "./RunInspectorArtifacts";
import { RetryStepDialog } from "./RetryStepDialog";
import { RunGuidance } from "./RunGuidance";

type Tab = "Activity" | "Files" | "Artifacts" | "Details";
const tabs: Tab[] = ["Activity", "Files", "Artifacts", "Details"];

export const RunInspector = ({
  run,
  summary = null,
  scope: requestedScope,
  onScopeChange,
  onClose,
  connected,
  agents = [],
  onSendGuidance = async () => undefined,
  initialTab = "Activity",
  onRetry,
  executing = false,
}: {
  run: RunRecord;
  summary?: EvidenceSummary | null;
  scope: RunScope;
  onScopeChange: (scope: RunScope) => void;
  onClose: () => void;
  connected: boolean;
  agents?: AgentConnection[];
  onSendGuidance?: (input: { stepId: string; attemptId: string; message: string }) => Promise<void>;
  initialTab?: Tab;
  onRetry?: ((stepId: string, attemptId: string) => void) | undefined;
  executing?: boolean;
}) => {
  const scope = validScope(run, requestedScope);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [width, setWidth] = useState(520);
  const [retryOpen, setRetryOpen] = useState(false);
  const retryTrigger = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drag = useRef(false);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !retryOpen) onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose, retryOpen]);
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
  const latestAttempt = step?.attempts.at(-1);
  const connection =
    definition &&
    agents.find((agent) => agent.provider === run.snapshot.bindings[definition.id]?.provider);
  const connectionReady =
    definition?.kind === "check" ||
    run.snapshot.bindings[definition?.id ?? ""]?.provider === "mock" ||
    connection?.authentication === "authenticated";
  const retryReason = !connected
    ? "Reconnect the runtime first."
    : executing
      ? "Work is already active."
      : run.status !== "failed" || step?.status !== "failed"
        ? "Only failed work can be retried."
        : scope.kind === "step" && scope.attemptId !== latestAttempt?.id
          ? "Select the latest attempt to retry."
          : !connectionReady
            ? "Verify this step’s connection before retrying."
            : step &&
                step.attempts.filter((item) => item.implementationRound === run.implementationRound)
                  .length >= run.snapshot.loop.policy.maxAttemptsPerStep
              ? "Attempt limit reached for this step."
              : "";
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
            <NativeSelect
              className="w-auto min-w-36"
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
            </NativeSelect>
          )}
          {step && onRetry && (
            <Button
              ref={retryTrigger}
              size="sm"
              variant="outline"
              disabled={Boolean(retryReason)}
              title={retryReason || undefined}
              onClick={() => setRetryOpen(true)}
            >
              Retry…
            </Button>
          )}
        </div>
        {step && latestAttempt && onRetry && (
          <RetryStepDialog
            run={run}
            stepId={step.stepId}
            open={retryOpen}
            onOpenChange={setRetryOpen}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              retryTrigger.current?.focus();
            }}
            onConfirm={() => {
              setRetryOpen(false);
              onRetry(step.stepId, latestAttempt.id);
            }}
          />
        )}
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
          <RunInspectorDetails run={run} scope={scope} summary={summary} />
        ) : tab === "Files" ? (
          <RunInspectorFiles run={run} scope={scope} />
        ) : (
          <RunInspectorArtifacts run={run} scope={scope} />
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
