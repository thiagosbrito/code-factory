import { renderHook } from "@testing-library/react";
import type { LoopDefinition } from "../../src/domain/loop.js";
import { useGraphEditor } from "../../src/ui/features/loops/graph/useGraphEditor.js";
import { commit, type History } from "../../src/ui/features/loops/loop-editor-model.js";

/** A minimal stand-in for the editor controller's `apply`, with the same commit/throw contract. */
export const harness = (initial: LoopDefinition) => {
  let history: History = { present: initial, past: [], future: [] };
  const errors: string[] = [];
  const apply = (action: (current: LoopDefinition) => LoopDefinition) => {
    try {
      history = commit(history, action(history.present));
      return true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const hook = renderHook(() =>
    useGraphEditor({ loop: history.present, apply, openDrawer: () => undefined }),
  );
  return { hook, errors, history: () => history };
};
