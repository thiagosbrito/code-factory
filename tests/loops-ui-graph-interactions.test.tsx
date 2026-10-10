// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { parseLoop, type LoopDefinition } from "../src/domain/loop.js";
import { createStarterDraft } from "../src/domain/starter-templates.js";
import { LoopEditor } from "../src/ui/features/loops/LoopEditor.js";
import { loopEditorViewStorageKey } from "../src/ui/features/loops/loop-editor-view.js";
import { laneOriginX } from "../src/ui/features/loops/graph/graph-layout.js";
import { project } from "./support/loops-ui.js";
import { stubReactFlowGlobals } from "./support/react-flow.js";

/**
 * jsdom cannot perform pointer drags, so the library component is wrapped to capture the props the
 * Graph view gives it, and the gestures are delivered the way the library would deliver them. The
 * real component tree, editor controller and history still run underneath.
 */
type FlowProps = Parameters<typeof import("@xyflow/react").ReactFlow>[0];
const captured: { props: FlowProps | null } = { props: null };

vi.mock("@xyflow/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...original,
    ReactFlow: (props: FlowProps) => {
      captured.props = props;
      return createElement(original.ReactFlow, props);
    },
  };
});

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(loopEditorViewStorageKey, "graph");
  stubReactFlowGlobals();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  captured.props = null;
});

const open = async () => {
  render(
    <LoopEditor
      initial={createStarterDraft("compact", "starter")}
      project={project}
      agents={[]}
      onBack={() => undefined}
      onPublished={async () => undefined}
    />,
  );
  await screen.findByRole("region", { name: "Graph view" });
};

const edgeNames = () =>
  [...document.querySelectorAll(".react-flow__edge")].map((item) =>
    item.getAttribute("aria-label"),
  );
const button = (name: string) => screen.getByRole("button", { name });

const props = (): FlowProps => {
  if (!captured.props) throw new Error("The graph did not render");
  return captured.props;
};

describe("Graph view gestures delivered through the component", () => {
  it("adds a dependency on connect and Undo takes it away", async () => {
    await open();
    act(() =>
      props().onConnect?.({
        source: "implement",
        target: "validate",
        sourceHandle: null,
        targetHandle: null,
      }),
    );
    await vi.waitFor(() => expect(edgeNames()).toContain("Dependency from Implement to Validate"));
    expect(button("Save draft").hasAttribute("disabled")).toBe(false);
    act(() => button("Undo").click());
    await vi.waitFor(() => expect(edgeNames()).toHaveLength(2));
  });

  it("moves a dropped step into the lane under it as one undo entry", async () => {
    await open();
    const flow = props();
    const node = flow.nodes?.find((item) => item.id === "implement");
    if (!node) throw new Error("missing node");
    const moved = { ...node, position: { x: laneOriginX("planning") + 20, y: 200 } };
    act(() => flow.onNodeDragStop?.(new MouseEvent("mouseup"), moved, [moved]));
    await vi.waitFor(() => {
      const shown = props().nodes?.find((item) => item.id === "implement");
      expect(shown?.position.x).toBe(laneOriginX("planning") + 20);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => button("Undo").click());
    await vi.waitFor(() => {
      const shown = props().nodes?.find((item) => item.id === "implement");
      expect(shown?.position.x).toBe(laneOriginX("implementation") + 16);
    });
    expect(button("Undo").hasAttribute("disabled")).toBe(true);
  });

  it("restores a loop that had no positions with one Undo after the first drop", async () => {
    await open();
    const flow = props();
    const node = flow.nodes?.find((item) => item.id === "implement");
    if (!node) throw new Error("missing node");
    const moved = { ...node, position: { x: node.position.x + 10, y: 400 } };
    act(() => flow.onNodeDragStop?.(new MouseEvent("mouseup"), moved, [moved]));
    await vi.waitFor(() => expect(button("Undo").hasAttribute("disabled")).toBe(false));
    expect(button("Save draft").hasAttribute("disabled")).toBe(false);
    // The first drop writes every step's position; a single Undo takes all of them away again.
    act(() => button("Undo").click());
    await vi.waitFor(() => expect(button("Undo").hasAttribute("disabled")).toBe(true));
    expect(button("Save draft").hasAttribute("disabled")).toBe(true);
    expect(button("Redo").hasAttribute("disabled")).toBe(false);
    const drawn = props().nodes?.find((item) => item.id === "implement");
    expect(drawn?.position).toEqual(node.position);
  });

  it("gives a step added after the first drop a free row, not a stored step's spot", async () => {
    await open();
    const flow = props();
    const node = flow.nodes?.find((item) => item.id === "implement");
    if (!node) throw new Error("missing node");
    const moved = { ...node, position: { x: node.position.x, y: 400 } };
    act(() => flow.onNodeDragStop?.(new MouseEvent("mouseup"), moved, [moved]));
    await vi.waitFor(() => expect(button("Undo").hasAttribute("disabled")).toBe(false));
    act(() => button("+ Agent step").click());
    await vi.waitFor(() =>
      expect(props().nodes?.filter((item) => item.type === "step")).toHaveLength(4),
    );
    const steps = (props().nodes ?? []).filter((item) => item.type === "step");
    const fresh = steps.find((item) => item.id.startsWith("step-"));
    if (!fresh) throw new Error("the new step is not drawn");
    for (const other of steps.filter((item) => item !== fresh))
      expect(
        Math.abs(other.position.x - fresh.position.x) < 210 &&
          Math.abs(other.position.y - fresh.position.y) < 102,
      ).toBe(false);
    // The saved draft carries a position for every step, which is what the Runs graph reads.
    const saves: LoopDefinition[] = [];
    vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
      if (path === "/api/native/formats") return Response.json({ formats: [] });
      const body = parseLoop(JSON.parse(String(options?.body)));
      saves.push(body);
      return Response.json({ loop: body });
    });
    act(() => button("Save draft").click());
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]?.steps).toHaveLength(4);
    expect(saves[0]?.steps.every((step) => step.position !== undefined)).toBe(true);
  });

  it("does not open the step drawer when a drag ends", async () => {
    await open();
    const flow = props();
    const node = flow.nodes?.find((item) => item.id === "review");
    if (!node) throw new Error("missing node");
    const moved = { ...node, position: { x: node.position.x + 10, y: node.position.y + 130 } };
    act(() => flow.onNodeDragStart?.(new MouseEvent("mousedown"), node, [node]));
    act(() => flow.onNodeDragStop?.(new MouseEvent("mouseup"), moved, [moved]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
