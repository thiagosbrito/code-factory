import { useCallback, useState } from "react";

export type LoopEditorView = "board" | "graph";

export const loopEditorViewStorageKey = "code-factory:loop-editor-view";

export const loopEditorViews: { id: LoopEditorView; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "graph", label: "Graph" },
];

/** Reads the remembered view; any storage failure or unknown value yields the Board. */
export const readLoopEditorView = (): LoopEditorView => {
  try {
    return window.localStorage.getItem(loopEditorViewStorageKey) === "graph" ? "graph" : "board";
  } catch {
    return "board";
  }
};

export const writeLoopEditorView = (view: LoopEditorView) => {
  try {
    window.localStorage.setItem(loopEditorViewStorageKey, view);
  } catch {
    // Storage can be blocked; the choice then lasts for this editor session only.
  }
};

/** The selected editor view, remembered per browser. It never touches the loop draft. */
export const useLoopEditorView = () => {
  const [view, setViewState] = useState<LoopEditorView>(readLoopEditorView);
  const setView = useCallback((next: LoopEditorView) => {
    setViewState(next);
    writeLoopEditorView(next);
  }, []);
  return { view, setView };
};
