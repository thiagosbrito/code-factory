import type { KeyboardEvent } from "react";
import type { Evidence } from "../../../../domain/evidence.js";
import { INSPECTOR_TABS, inspectorTabId, type InspectorTab } from "./useInspectorTabs";

export const InspectorTabs = ({
  tab,
  evidence,
  onChange,
  onKeyDown,
}: {
  tab: InspectorTab;
  evidence: Evidence[];
  onChange: (tab: InspectorTab) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}) => (
  <div
    role="tablist"
    aria-label="Inspector tabs"
    tabIndex={-1}
    className="mt-4 flex gap-1"
    onKeyDown={onKeyDown}
  >
    {INSPECTOR_TABS.map((item) => (
      <button
        key={item}
        id={inspectorTabId(item)}
        role="tab"
        aria-selected={tab === item}
        tabIndex={tab === item ? 0 : -1}
        className={`border-b-2 px-2 py-2 text-xs font-semibold ${tab === item ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        onClick={() => onChange(item)}
      >
        {item}
        {item === "Files" || item === "Artifacts"
          ? ` (${evidence.filter((entry) => entry.kind === (item === "Files" ? "file" : "artifact")).length})`
          : ""}
      </button>
    ))}
  </div>
);
