// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LoopDefinition } from "../src/domain/loop.js";
import { createStarterDraft } from "../src/domain/starter-templates.js";
import { LoopEditor } from "../src/ui/features/loops/LoopEditor.js";
import { loopEditorViewStorageKey } from "../src/ui/features/loops/loop-editor-view.js";
import { NODE_HEIGHT, ROW_HEIGHT } from "../src/ui/features/loops/graph/graph-layout.js";
import { build } from "./support/loop-editor-builders.js";
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

const open = async (initial: LoopDefinition = createStarterDraft("compact", "starter")) => {
  render(
    <LoopEditor
      initial={initial}
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
const status = () => screen.getByRole("status", { name: "Graph announcements" }).textContent;

const selectEdge = (label: string) => {
  const target = document.querySelector(`.react-flow__edge[aria-label="${label}"]`);
  if (!(target instanceof SVGElement)) throw new Error(`No edge ${label}`);
  fireEvent.click(target);
  target.focus();
};

/** Focuses a step and selects it the way a keyboard user does. */
const selectStep = async (user: ReturnType<typeof userEvent.setup>, node: HTMLElement) => {
  node.focus();
  await user.keyboard(" ");
  expect(node.classList.contains("selected")).toBe(true);
};

describe("moving a selected step with the arrow keys", () => {
  it("records the moves in the loop as one undo entry that Undo restores", async () => {
    const user = userEvent.setup();
    await open();
    const before = drawnAt(reviewNode());
    await selectStep(user, reviewNode());
    expect(isDisabled("Undo")).toBe(true);
    await user.keyboard("{ArrowRight}");
    // The loop recorded the move; moving only the flow state would leave Undo and Save disabled.
    await vi.waitFor(() => expect(isDisabled("Undo")).toBe(false));
    expect(isDisabled("Save draft")).toBe(false);
    expect(drawnAt(reviewNode())).toEqual({ x: before.x + 10, y: before.y });
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(drawnAt(reviewNode()).y).toBe(before.y + 40);
    expect(status()).toBe("Review moved down");
    // The node keeps keyboard focus so the next key press still reaches it.
    expect(document.activeElement).toBe(reviewNode());
    // Undo with the keyboard shortcut, inside the same session: focus never left the graph.
    await user.keyboard("{Control>}z{/Control}");
    await vi.waitFor(() => expect(drawnAt(reviewNode())).toEqual(before));
    expect(isDisabled("Undo")).toBe(true);
    expect(isDisabled("Save draft")).toBe(true);
    // A move after that Undo is a fresh entry, not folded into anything older.
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(isDisabled("Undo")).toBe(false));
    await user.keyboard("{Control>}z{/Control}");
    await vi.waitFor(() => expect(drawnAt(reviewNode())).toEqual(before));
    expect(isDisabled("Undo")).toBe(true);
  });

  it("changes the announcement on every press, even for the same message", async () => {
    const user = userEvent.setup();
    await open();
    await selectStep(user, reviewNode());
    await user.keyboard("{ArrowDown}");
    const first = status();
    expect(first).toBe("Review moved down");
    await user.keyboard("{ArrowDown}");
    const second = status();
    expect(second?.trim()).toBe("Review moved down");
    // A live region only speaks when its text changes.
    expect(second).not.toBe(first);
    await user.keyboard("{ArrowDown}");
    expect(status()).not.toBe(second);
  });

  it("holding an arrow is one undo entry, and moving focus away starts a new one", async () => {
    const user = userEvent.setup();
    await open();
    const before = drawnAt(reviewNode());
    await selectStep(user, reviewNode());
    for (let press = 0; press < 10; press += 1) await user.keyboard("{ArrowDown}");
    expect(drawnAt(reviewNode()).y).toBe(before.y + 100);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await vi.waitFor(() => expect(drawnAt(reviewNode())).toEqual(before));
    expect(isDisabled("Undo")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Redo" }));
    reviewNode().focus();
    await user.keyboard("{ArrowDown}");
    reviewNode().blur();
    reviewNode().focus();
    await user.keyboard("{ArrowDown}");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await vi.waitFor(() => expect(drawnAt(reviewNode()).y).toBe(before.y + 110));
    expect(isDisabled("Undo")).toBe(false);
  });

  it("keeps a step inside its lane and says when it is at the edge", async () => {
    const user = userEvent.setup();
    await open();
    await selectStep(user, reviewNode());
    const before = drawnAt(reviewNode());
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    // The lane allows 8 px of padding at its left edge, so 40 px of key press stops 8 px short.
    const after = drawnAt(reviewNode());
    expect(after).toEqual({ x: before.x - 8, y: before.y });
    await user.keyboard("{ArrowLeft}");
    expect(status()).toBe("Review is at the lane edge");
    expect(drawnAt(reviewNode())).toEqual(after);
    // Undo and Redo redraw the node from the loop; only a recorded position survives that.
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await vi.waitFor(() => expect(drawnAt(reviewNode())).toEqual(before));
    await user.click(screen.getByRole("button", { name: "Redo" }));
    await vi.waitFor(() => expect(drawnAt(reviewNode())).toEqual(after));
  });

  it("never moves the step the wrong way near a neighbour and records nothing once blocked", async () => {
    const user = userEvent.setup();
    await open(build(["a", "b"]));
    const a = () => screen.getByRole("group", { name: /^a, Role/ });
    const start = drawnAt(a());
    await selectStep(user, a());
    const seen: number[] = [];
    // The blocked presses alternate the announcement text; keep their count odd, as it was.
    const presses = Math.floor((ROW_HEIGHT - NODE_HEIGHT) / 10) + 7;
    for (let press = 0; press < presses; press += 1) {
      await user.keyboard("{ArrowDown}");
      seen.push(drawnAt(a()).y);
    }
    // Each press moves 10 px. Moves that keep a node's height clear of b (one row away) are fine;
    // the next press would overlap it, and the nearest free row is the step's old one, which is
    // UP: that press is blocked instead.
    const clearMoves = Math.floor((ROW_HEIGHT - NODE_HEIGHT) / 10);
    const clear = Array.from({ length: clearMoves }, (_, index) => start.y + 10 * (index + 1));
    expect(seen.every((y) => y >= start.y)).toBe(true);
    expect(new Set(seen)).toEqual(new Set(clear));
    expect(status()).toBe("a cannot move further down");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await vi.waitFor(() => expect(drawnAt(a())).toEqual(start));
    expect(isDisabled("Undo")).toBe(true);
  });
});

describe("arrow keys the editor leaves alone", () => {
  it("does nothing, and does not cancel the key, on a focused step that is not selected", async () => {
    const user = userEvent.setup();
    await open();
    await selectStep(user, screen.getByRole("group", { name: /^Implement, / }));
    const implement = screen.getByRole("group", { name: /^Implement, / });
    const implementBefore = drawnAt(implement);
    const review = reviewNode();
    const before = drawnAt(review);
    review.focus();
    // fireEvent returns false when the default was cancelled: here nothing handles the key.
    expect(fireEvent.keyDown(review, { key: "ArrowDown" })).toBe(true);
    expect(isDisabled("Undo")).toBe(true);
    expect(drawnAt(review)).toEqual(before);
    // The selected step is not dragged along by a key pressed on another step.
    expect(drawnAt(implement)).toEqual(implementBefore);
  });

  it("keeps Ctrl, Meta and Alt arrows for moving focus: they never move or record the step", async () => {
    const user = userEvent.setup();
    await open();
    await selectStep(user, reviewNode());
    const before = drawnAt(reviewNode());
    for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const)
      expect(fireEvent.keyDown(reviewNode(), { key: "ArrowDown", [modifier]: true })).toBe(false);
    // Claimed for focus movement, so not recorded and not moved in the library's flow state.
    expect(isDisabled("Undo")).toBe(true);
    expect(drawnAt(reviewNode())).toEqual(before);
  });

  it("claims an arrow on a selected step so the page does not scroll", async () => {
    const user = userEvent.setup();
    await open();
    await selectStep(user, reviewNode());
    expect(fireEvent.keyDown(reviewNode(), { key: "ArrowDown" })).toBe(false);
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
