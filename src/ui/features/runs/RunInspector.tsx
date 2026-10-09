import { useRef, useState } from "react";
import type { RunRecord } from "../../../domain/run.js";
import type { EvidenceSummary } from "../../../domain/acceptance.js";
import type { AgentConnection } from "../../../adapters/contract.js";
import { InspectorHeader } from "./run-inspector/InspectorHeader";
import { InspectorResizeHandle } from "./run-inspector/InspectorResizeHandle";
import { InspectorTabs } from "./run-inspector/InspectorTabs";
import { retryReason } from "./run-inspector/retry-reason";
import { useInspectorLifecycle } from "./run-inspector/useInspectorLifecycle";
import {
  inspectorTabId,
  useInspectorTabs,
  type InspectorTab,
} from "./run-inspector/useInspectorTabs";
import { useInspectorWidth } from "./run-inspector/useInspectorWidth";
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
import { RunGuidance } from "./RunGuidance";

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
  initialTab?: InspectorTab;
  onRetry?:
    | ((stepId: string, attemptId: string, focusTarget?: HTMLElement | null) => void)
    | undefined;
  executing?: boolean;
}) => {
  const scope = validScope(run, requestedScope);
  const { tab, setTab, handleKeys } = useInspectorTabs(initialTab);
  const [retryOpen, setRetryOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useInspectorLifecycle({ closeRef, retryOpen, scope, requestedScope, onClose, onScopeChange });
  const { width, setWidth, startDrag } = useInspectorWidth();
  const step = stepForScope(run, scope);
  const definition = definitionForScope(run, scope);
  return (
    <aside
      className="run-inspector fixed bottom-0 left-0 top-0 z-40 flex max-w-[100vw] flex-col border-r bg-white shadow-xl md:left-[232px]"
      style={{ width }}
      aria-label="Run inspector"
    >
      <InspectorResizeHandle width={width} onWidthChange={setWidth} onDragStart={startDrag} />
      <InspectorHeader
        run={run}
        scope={scope}
        step={step}
        definition={definition}
        closeRef={closeRef}
        retryReason={retryReason({ run, scope, step, definition, agents, connected, executing })}
        retryOpen={retryOpen}
        onRetryOpenChange={setRetryOpen}
        onRetry={onRetry}
        onClose={onClose}
        onScopeChange={onScopeChange}
      >
        <InspectorTabs
          tab={tab}
          evidence={scopeEvidence(run, scope)}
          onChange={setTab}
          onKeyDown={handleKeys}
        />
      </InspectorHeader>
      <div
        role="tabpanel"
        aria-labelledby={inspectorTabId(tab)}
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
