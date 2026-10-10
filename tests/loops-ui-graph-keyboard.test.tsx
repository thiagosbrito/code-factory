// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStarterDraft } from "../src/domain/starter-templates.js";
import { LoopEditor } from "../src/ui/features/loops/LoopEditor.js";
import { loopEditorViewStorageKey } from "../src/ui/features/loops/loop-editor-view.js";
import { project } from "./support/loops-ui.js";
import { stubReactFlowGlobals } from "./support/react-flow.js";

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(loopEditorViewStorageKey, "graph");
  stubReactFlowGlobals();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

const reviewNode = () => screen.getByRole("group", { name: /^Review, Reviewer/ });
/** Where the node is drawn, read from the transform the library gives its element. */
const drawnAt = (node: HTMLElement) => {
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(node.style.transform);
  if (!match) throw new Error(`No transform on ${node.style.transform}`);
  return { x: Number(match[1]), y: Number(match[2]) };
};
const edgeNames = () =>
  [...document.querySelectorAll(".react-flow__edge")].map((item) =>
    item.getAttribute("aria-label"),
  );
const isDisabled = (name: string) => screen.getByRole("button", { name }).hasAttribute("disabled");

const selectEdge = (label: string) => {
  const target = document.querySelector(`.react-flow__edge[aria-label="${label}"]`);
  if (!(target instanceof SVGElement)) throw new Error(`No edge ${label}`);
  fireEvent.click(target);
  target.focus();
};

describe("moving a selected step with the arrow keys", () => {
  it("records the move in the loop as one undo entry that Undo restores", async () => {
    const user = userEvent.setup();
    await open();
    const before = drawnAt(reviewNode());
    reviewNode().focus();
    await user.keyboard("{Enter}");
    expect(isDisabled("Undo")).toBe(true);
    await user.keyboard("{ArrowRight}");
    // The loop recorded the move; moving only the flow state would leave Undo and Save disabled.
    await vi.waitFor(() => expect(isDisabled("Undo")).toBe(false));
    expect(isDisabled("Save draft")).toBe(false);
    expect(drawnAt(reviewNode())).toEqual({ x: before.x + 5, y: before.y });
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(drawnAt(reviewNode()).y).toBe(before.y + 20);
    // The node keeps keyboard focus so the next key press still reaches it.
    expect(document.activeElement).toBe(reviewNode());
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await vi.waitFor(() => expect(drawnAt(reviewNode())).toEqual(before));
    expect(isDisabled("Save draft")).toBe(true);
  });

  it("keeps a step inside its lane instead of drawing it where the loop cannot store it", async () => {
    const user = userEvent.setup();
    await open();
    reviewNode().focus();
    await user.keyboard("{Enter}");
    const before = drawnAt(reviewNode());
    await user.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}");
    await vi.waitFor(() => expect(isDisabled("Undo")).toBe(false));
    // The lane allows 8 px of padding at its left edge, so 80 px of key presses stop 8 px short.
    const after = drawnAt(reviewNode());
    expect(after).toEqual({ x: before.x - 8, y: before.y });
    // Undo and Redo redraw the node from the loop; only a recorded position survives that.
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await vi.waitFor(() => expect(drawnAt(reviewNode())).toEqual(before));
    await user.click(screen.getByRole("button", { name: "Redo" }));
    await vi.waitFor(() => expect(drawnAt(reviewNode())).toEqual(after));
  });

  it("does not move a step that was never selected", async () => {
    const user = userEvent.setup();
    await open();
    reviewNode().focus();
    await user.keyboard("{ArrowDown}");
    expect(isDisabled("Undo")).toBe(true);
  });
});

describe("Delete and Backspace on the graph", () => {
  it("keeps focus in the graph after the key removes the edge", async () => {
    const user = userEvent.setup();
    await open();
    selectEdge("Dependency from Implement to Review");
    await user.keyboard("{Delete}");
    await vi.waitFor(() => expect(edgeNames()).toEqual(["Dependency from Review to Validate"]));
    expect(document.activeElement?.classList.contains("react-flow")).toBe(true);
  });

  it("does nothing while focus is on a zoom control inside the graph", async () => {
    const user = userEvent.setup();
    await open();
    selectEdge("Dependency from Implement to Review");
    const zoomIn = screen.getByRole("button", { name: "Zoom In" });
    zoomIn.focus();
    await user.keyboard("{Delete}{Backspace}");
    expect(edgeNames()).toHaveLength(2);
    expect(isDisabled("Undo")).toBe(true);
  });

  it("does nothing while focus is on the edge's own delete button", async () => {
    const user = userEvent.setup();
    await open();
    selectEdge("Dependency from Implement to Review");
    const remove = await screen.findByRole("button", {
      name: "Delete: Dependency from Implement to Review",
    });
    remove.focus();
    await user.keyboard("{Delete}");
    expect(edgeNames()).toHaveLength(2);
    expect(isDisabled("Undo")).toBe(true);
  });
});
