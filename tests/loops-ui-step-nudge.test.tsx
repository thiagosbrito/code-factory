// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStarterDraft } from "../src/domain/starter-templates.js";
import { LoopEditor } from "../src/ui/features/loops/LoopEditor.js";
import { laneOriginX } from "../src/ui/features/loops/graph/graph-layout.js";
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

const transformOf = (name: RegExp) => {
  const node = screen.getByRole("group", { name, hidden: true });
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(node.style.transform);
  if (!match) throw new Error("No transform");
  return { x: Number(match[1]), y: Number(match[2]) };
};

describe("Nudge visual right in the step drawer", () => {
  it("keeps positions all-or-none and refuses once the step is at its lane's edge", async () => {
    const user = userEvent.setup();
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
    const reviewBefore = transformOf(/^Review, Reviewer/);
    const implementBefore = transformOf(/^Implement, /);
    fireEvent.click(screen.getByRole("group", { name: /^Review, Reviewer/ }));
    const drawer = await screen.findByRole("dialog", { name: "Step configuration" });
    await user.click(within(drawer).getByRole("button", { name: "Nudge visual right" }));
    // A first nudge on a loop with no positions used to store {x: 20, y: 0} for this step alone.
    await vi.waitFor(() =>
      expect(transformOf(/^Review, Reviewer/)).toEqual({
        x: laneOriginX("review") + 36,
        y: reviewBefore.y,
      }),
    );
    expect(transformOf(/^Implement, /)).toEqual(implementBefore);
    await user.click(within(drawer).getByRole("button", { name: "Nudge visual right" }));
    expect((await within(drawer).findByRole("alert")).textContent).toContain(
      "already at the right edge of its lane",
    );
    expect(transformOf(/^Review, Reviewer/).x).toBe(laneOriginX("review") + 36);
  });

  it("applies in the same event, with no window for a concurrent edit to be lost", async () => {
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
    const before = transformOf(/^Review, Reviewer/);
    fireEvent.click(screen.getByRole("group", { name: /^Review, Reviewer/ }));
    const drawer = await screen.findByRole("dialog", { name: "Step configuration" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Nudge visual right" }));
    // No await: the nudge is a plain synchronous edit, not a deferred one.
    expect(transformOf(/^Review, Reviewer/).x).toBe(laneOriginX("review") + 36);
    expect(transformOf(/^Review, Reviewer/).y).toBe(before.y);
  });
});
