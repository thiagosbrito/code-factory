// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { LoopDefinition } from "../src/domain/loop.js";
import {
  FIRST_ROW_Y,
  laneOriginX,
  ROW_HEIGHT,
} from "../src/ui/features/loops/graph/graph-layout.js";
import type { GraphNode } from "../src/ui/features/loops/graph/graph-mapping.js";
import { useGraphEditor } from "../src/ui/features/loops/graph/useGraphEditor.js";
import { moveVisual } from "../src/ui/features/loops/loop-editor-model.js";
import { graphHarness } from "./support/graph-editor-harness.js";
import { chain } from "./support/loop-editor-builders.js";
import { stubReactFlowGlobals } from "./support/react-flow.js";

beforeEach(stubReactFlowGlobals);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const lane = laneOriginX("implementation");
const row = (index: number) => FIRST_ROW_Y + index * ROW_HEIGHT;
const stepNodes = (nodes: GraphNode[]) =>
  nodes.flatMap((node) => (node.type === "step" ? [node] : []));
const stepNode = (nodes: GraphNode[], id: string) => {
  const found = stepNodes(nodes).find((node) => node.id === id);
  if (!found) throw new Error(`missing node ${id}`);
  return found;
};

describe("dragging a box selection", () => {
  it("commits a selection drag as one undo entry with every moved step", () => {
    const { hook, history } = graphHarness(chain());
    const a = stepNode(hook.result.current.nodes, "a");
    const b = stepNode(hook.result.current.nodes, "b");
    const event = new MouseEvent("mouseup");
    const moved = [
      { ...a, position: { x: lane + 30, y: row(1) } },
      { ...b, position: { x: lane + 30, y: row(0) } },
    ];
    act(() => hook.result.current.onSelectionDragStart(event, [a, b]));
    act(() => hook.result.current.onSelectionDragStop(event, moved));
    expect(history().past).toHaveLength(1);
    const steps = history().present.steps;
    expect(steps.find((step) => step.id === "a")?.position).toEqual({ x: lane + 30, y: row(1) });
    expect(steps.find((step) => step.id === "b")?.position?.x).toBe(lane + 30);
    expect(steps.every((step) => step.position)).toBe(true);
  });

  it("writes nothing when the selection is dropped where it is drawn", () => {
    const { hook, history } = graphHarness(chain());
    const a = stepNode(hook.result.current.nodes, "a");
    const event = new MouseEvent("mouseup");
    act(() => hook.result.current.onSelectionDragStart(event, [a]));
    act(() => hook.result.current.onSelectionDragStop(event, [a]));
    expect(history().past).toEqual([]);
  });
});

describe("a reseed during a drag", () => {
  it("leaves the dragged node alone and reconciles with the newest loop on drop", () => {
    const apply = vi.fn<(action: (current: LoopDefinition) => LoopDefinition) => boolean>(
      () => false,
    );
    const newest = moveVisual(chain(), "a", lane + 30, row(3));
    const hook = renderHook(
      ({ loop }) => useGraphEditor({ loop, apply, openDrawer: () => undefined }),
      { initialProps: { loop: chain() } },
    );
    const before = stepNode(hook.result.current.nodes, "a");
    const event = new MouseEvent("mouseup");
    act(() => hook.result.current.onNodeDragStart(event, before, [before]));
    hook.rerender({ loop: newest });
    // Undo (or any loop change) mid-drag must not yank the node from under the pointer.
    expect(stepNode(hook.result.current.nodes, "a").position).toEqual(before.position);
    const dropped = { ...before, position: { x: lane + 30, y: row(2) } };
    act(() => hook.result.current.onNodeDragStop(event, dropped, [dropped]));
    // The drop was planned against the newest loop, and the refused drop redraws from it.
    const action = apply.mock.calls[0]?.[0];
    if (!action) throw new Error("the drop did not reach apply");
    expect(action(newest).steps.find((step) => step.id === "a")?.position).toEqual({
      x: lane + 30,
      y: row(2),
    });
    expect(stepNode(hook.result.current.nodes, "a").position).toEqual({ x: lane + 30, y: row(3) });
  });
});
