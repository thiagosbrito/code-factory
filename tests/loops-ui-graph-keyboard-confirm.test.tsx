// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoopEditor } from "../src/ui/features/loops/LoopEditor.js";
import { planKeyboardMove } from "../src/ui/features/loops/graph/graph-actions.js";
import { laneOriginX } from "../src/ui/features/loops/graph/graph-layout.js";
import { loopEditorViewStorageKey } from "../src/ui/features/loops/loop-editor-view.js";
import { build, edge } from "./support/loop-editor-builders.js";
import { project } from "./support/loops-ui.js";
import { stubReactFlowGlobals } from "./support/react-flow.js";

// Real arrow presses never leave a lane (the lane clamp stops them first), so the planner is
// stubbed to return a plan that crosses into Review: this exercises the confirmation path itself.
vi.mock("../src/ui/features/loops/graph/graph-actions.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/ui/features/loops/graph/graph-actions.js")>();
  return {
    ...actual,
    planKeyboardMove: vi.fn<typeof actual.planKeyboardMove>(actual.planKeyboardMove),
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
});

const open = async () => {
  render(
    <LoopEditor
      initial={build(["a", "b"], { dependencies: [edge("a", "b")] })}
      project={project}
      agents={[]}
      onBack={() => undefined}
      onPublished={async () => undefined}
    />,
  );
  await screen.findByRole("region", { name: "Graph view" });
  const node = screen.getByRole("group", { name: /^a, Role/ });
  node.focus();
  await userEvent.keyboard(" ");
  return node;
};
const isDisabled = (name: string) => screen.getByRole("button", { name }).hasAttribute("disabled");
const intoReview = () =>
  vi.mocked(planKeyboardMove).mockReturnValueOnce({
    kind: "moved",
    drops: [{ id: "a", stage: "review", position: { x: laneOriginX("review") + 16, y: 48 } }],
  });
const ask = async () => {
  intoReview();
  await userEvent.keyboard("{ArrowRight}");
  return screen.findByRole("dialog", { name: "Apply this change?" });
};

describe("an arrow-key move into the Review lane", () => {
  it("asks first and leaves the loop unchanged", async () => {
    await open();
    const dialog = await ask();
    expect(within(dialog).getByText(/into the Review lane/)).toBeTruthy();
    expect(
      document.querySelector('output[aria-label="Graph announcements"]')?.textContent,
    ).toContain("Confirmation needed before moving a right");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(isDisabled("Undo")).toBe(true);
    expect(isDisabled("Save draft")).toBe(true);
  });

  it("Cancel keeps the step in its lane", async () => {
    const node = await open();
    const before = node.style.transform;
    const dialog = await ask();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("group", { name: /^a, Role/ }).style.transform).toBe(before);
  });

  it("Confirm applies it as one undo entry that Undo reverses", async () => {
    await open();
    const dialog = await ask();
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply change" }));
    await vi.waitFor(() => expect(isDisabled("Undo")).toBe(false));
    expect(screen.getByRole("group", { name: /^a, Role/ }).getAttribute("aria-label")).toContain(
      "in 4. Review",
    );
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await vi.waitFor(() => expect(isDisabled("Undo")).toBe(true));
    expect(screen.getByRole("group", { name: /^a, Role/ }).getAttribute("aria-label")).toContain(
      "in 3. Implementation",
    );
  });
});

describe("an arrow-key move that stays in its lane", () => {
  it("applies directly with no confirmation", async () => {
    await open();
    await userEvent.keyboard("{ArrowDown}");
    await vi.waitFor(() => expect(isDisabled("Undo")).toBe(false));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
