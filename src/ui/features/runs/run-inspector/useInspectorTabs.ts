import { useState, type KeyboardEvent } from "react";

export type InspectorTab = "Activity" | "Files" | "Artifacts" | "Details";
export const INSPECTOR_TABS: readonly InspectorTab[] = [
  "Activity",
  "Files",
  "Artifacts",
  "Details",
];

export const inspectorTabId = (tab: InspectorTab) => `run-inspector-tab-${tab}`;

/** The selected tab, and Left/Right on a tab moving to the neighbour (wrapping) and focusing it. */
export const useInspectorTabs = (initialTab: InspectorTab) => {
  const [tab, setTab] = useState<InspectorTab>(initialTab);
  const handleKeys = (event: KeyboardEvent) => {
    if (
      (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
      (event.target as HTMLElement).getAttribute("role") === "tab"
    ) {
      event.preventDefault();
      const index = INSPECTOR_TABS.indexOf(tab);
      const next =
        INSPECTOR_TABS[
          (index + (event.key === "ArrowRight" ? 1 : INSPECTOR_TABS.length - 1)) %
            INSPECTOR_TABS.length
        ];
      if (next) {
        setTab(next);
        document.getElementById(inspectorTabId(next))?.focus();
      }
    }
  };
  return { tab, setTab, handleKeys };
};
