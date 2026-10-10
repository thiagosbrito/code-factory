// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { LoopDefinition } from "../src/domain/loop.js";
import { useGraphEditor } from "../src/ui/features/loops/graph/useGraphEditor.js";
import { laneOriginX } from "../src/ui/features/loops/graph/graph-layout.js";
import { commit, type History } from "../src/ui/features/loops/loop-editor-model.js";
import { chain, cycleMessage, decided } from "./support/loop-editor-builders.js";
import { stubReactFlowGlobals } from "./support/react-flow.js";

beforeEach(stubReactFlowGlobals);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A minimal stand-in for the editor controller's `apply`, with the same commit/throw contract. */
const harness = (initial: LoopDefinition) => {
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

describe("Graph editor handlers", () => {
  it("validates a connection with a dry run that never changes the loop", () => {
    const { hook, history } = harness(chain());
    const { isValidConnection } = hook.result.current;
    const connect = (source: string, target: string) => ({
      source,
      target,
      sourceHandle: null,
      targetHandle: null,
    });
    expect(isValidConnection(connect("a", "c"))).toBe(true);
    expect(isValidConnection(connect("c", "a"))).toBe(false);
    expect(isValidConnection(connect("a", "b"))).toBe(false);
    expect(history().past).toEqual([]);
    expect(history().present.dependencies).toHaveLength(2);
  });

  it("adds a dependency on connect as one undo entry and ignores a repeated connect", () => {
    const { hook, history, errors } = harness(chain());
    const connection = { source: "a", target: "c", sourceHandle: null, targetHandle: null };
    act(() => hook.result.current.onConnect(connection));
    expect(history().present.dependencies).toContainEqual({ from: "a", to: "c" });
    expect(history().past).toHaveLength(1);
    hook.rerender();
    act(() => hook.result.current.onConnect(connection));
    expect(history().past).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("reports a refused connect through apply and leaves the loop and history alone", () => {
    const { hook, history, errors } = harness(chain());
    act(() =>
      hook.result.current.onConnect({
        source: "c",
        target: "a",
        sourceHandle: null,
        targetHandle: null,
      }),
    );
    expect(errors).toEqual([cycleMessage]);
    expect(history().past).toEqual([]);
    expect(history().present.dependencies).toHaveLength(2);
  });

  it("refuses to drop a decision below two branches and keeps the edges drawn", async () => {
    const { hook, history, errors } = harness(decided());
    const edges = hook.result.current.edges.filter((item) => item.source === "a");
    await act(async () => {
      const proceed = await hook.result.current.onBeforeDelete({ nodes: [], edges });
      expect(proceed).toBe(false);
    });
    expect(errors[0]).toContain("fewer than two branches");
    expect(history().past).toEqual([]);
    expect(hook.result.current.edges.map((item) => item.id)).toEqual(["a->b", "a->c"]);
  });

  it("commits a lane drop as a single undo entry and snaps back when refused", () => {
    const { hook, history, errors } = harness(decided());
    const nodes = hook.result.current.nodes;
    const b = nodes.find((node) => node.id === "b");
    if (!b || b.type !== "step") throw new Error("missing node b");
    // b is a decision target, not a decision itself: its lane can change.
    act(() =>
      hook.result.current.onNodeDragStop(
        new MouseEvent("mouseup"),
        { ...b, position: { x: laneOriginX("review") + 20, y: 200 } },
        [{ ...b, position: { x: laneOriginX("review") + 20, y: 200 } }],
      ),
    );
    expect(history().past).toHaveLength(1);
    expect(history().present.steps.find((step) => step.id === "b")).toMatchObject({
      stage: "review",
      position: { x: laneOriginX("review") + 20, y: 200 },
    });
    const a = nodes.find((node) => node.id === "a");
    if (!a || a.type !== "step") throw new Error("missing node a");
    hook.rerender();
    act(() =>
      hook.result.current.onNodeDragStop(
        new MouseEvent("mouseup"),
        { ...a, position: { x: laneOriginX("review") + 20, y: 200 } },
        [{ ...a, position: { x: laneOriginX("review") + 20, y: 200 } }],
      ),
    );
    expect(errors[0]).toContain("belongs to a group, join, or decision");
    expect(history().past).toHaveLength(1);
    const snapped = hook.result.current.nodes.find((node) => node.id === "a");
    expect(snapped?.position.x).toBe(laneOriginX("implementation") + 16);
  });
});
