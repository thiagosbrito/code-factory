import { useRef, useState } from "react";
import type { RunRecord } from "../../../../domain/run.js";
import type { RunScope } from "../run-view-model";
import type { RunPanel } from "./RunDetailNav";

export type InspectorTab = "Activity" | "Files" | "Artifacts";

/** Which dialog and inspector scope are open, and where focus returns when each closes. */
export const useRunDetailPanels = (run: RunRecord) => {
  const [scope, setScope] = useState<RunScope | null>(null);
  const [initialTab, setInitialTab] = useState<InspectorTab>("Activity");
  const [panel, setPanel] = useState<RunPanel | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const panelTriggers = useRef<Partial<Record<RunPanel, HTMLButtonElement | null>>>({});
  /** From the evidence dialog: close it, then open the run inspector, returning focus to its icon. */
  const handingOff = useRef(false);
  const open = (
    next: RunScope,
    tab: InspectorTab = "Activity",
    returnTo: HTMLElement | null = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  ) => {
    trigger.current = returnTo;
    setInitialTab(tab);
    setScope(next);
  };
  const close = () => {
    setScope(null);
    window.requestAnimationFrame(() => trigger.current?.focus());
  };
  const openStep = (stepId: string) => {
    const step = run.steps.find((item) => item.stepId === stepId);
    open({ kind: "step", stepId, attemptId: step?.attempts.at(-1)?.id ?? null });
  };
  /** Closing a detail dialog returns focus to its icon, unless it handed off to the inspector. */
  const returnFocus = (id: RunPanel) => (event: Event) => {
    event.preventDefault();
    if (handingOff.current) handingOff.current = false;
    else panelTriggers.current[id]?.focus();
  };
  const openFromEvidence = (tab: "Files" | "Artifacts") => {
    handingOff.current = true;
    setPanel(null);
    open({ kind: "run" }, tab, panelTriggers.current.evidence ?? null);
  };
  return {
    scope,
    setScope,
    initialTab,
    panel,
    setPanel,
    panelTriggers,
    open,
    close,
    openStep,
    returnFocus,
    openFromEvidence,
  };
};

export type RunDetailPanels = ReturnType<typeof useRunDetailPanels>;
