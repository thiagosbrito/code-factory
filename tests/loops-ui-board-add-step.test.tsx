// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseLoop, type LoopDefinition } from "../src/domain/loop.js";
import { createStarterDraft } from "../src/domain/starter-templates.js";
import { LoopEditor } from "../src/ui/features/loops/LoopEditor.js";
import { laneOriginX } from "../src/ui/features/loops/graph/graph-layout.js";
import { addStep, moveVisual } from "../src/ui/features/loops/loop-editor-model.js";
import { project } from "./support/loops-ui.js";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const editor = (initial: LoopDefinition) => (
  <LoopEditor
    initial={initial}
    project={project}
    agents={[]}
    onBack={() => undefined}
    onPublished={async () => undefined}
  />
);

/** Stubs the save endpoint and returns the drafts the editor saved. */
const captureSaves = () => {
  const saves: LoopDefinition[] = [];
  vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
    if (path === "/api/native/formats") return Response.json({ formats: [] });
    const body = parseLoop(JSON.parse(String(options?.body)));
    saves.push(body);
    return Response.json({ loop: body });
  });
  return saves;
};

const isDisabled = (name: string) => screen.getByRole("button", { name }).hasAttribute("disabled");

describe("adding a step on the Board", () => {
  it("stores no position on a loop without positions, as one undo entry", async () => {
    const user = userEvent.setup();
    const initial = createStarterDraft("compact", "starter");
    const saves = captureSaves();
    render(editor(initial));
    await user.click(screen.getAllByRole("button", { name: "+ Add step" })[2] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    const saved = saves[0];
    expect(saved?.steps.some((step) => step.position)).toBe(false);
    // The saved loop is exactly what addStep produces (the new step's id is random).
    const added = saved?.steps.find((step) => step.id.startsWith("step-"));
    expect(added).toBeDefined();
    expect(saved?.steps).toHaveLength(addStep(initial, "implementation", "agent").steps.length);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(isDisabled("Undo")).toBe(true);
    expect(screen.queryByText("New agent step")).toBeNull();
  });

  it("stores exactly the new step's position on a fully positioned loop, as one undo entry", async () => {
    const user = userEvent.setup();
    const base = createStarterDraft("compact", "starter");
    const positioned = base.steps.reduce(
      (loop, step) =>
        moveVisual(loop, step.id, laneOriginX(step.stage ?? "implementation") + 16, 48),
      base,
    );
    const saves = captureSaves();
    render(editor(positioned));
    await user.click(screen.getAllByRole("button", { name: "+ Add step" })[2] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    const saved = saves[0];
    for (const step of positioned.steps)
      expect(saved?.steps.find((item) => item.id === step.id)?.position).toEqual(step.position);
    const added = saved?.steps.find((step) => step.id.startsWith("step-"));
    // The implementation lane's first row is taken by the Implement step, so the next free row.
    expect(added?.position).toEqual({ x: laneOriginX("implementation") + 16, y: 168 });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(isDisabled("Undo")).toBe(true);
  });
});
