// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStarterDraft } from "../src/domain/starter-templates.js";
import type { LoopDefinition } from "../src/domain/loop.js";
import { LoopEditor } from "../src/ui/features/loops/LoopEditor.js";
import LoopGraphView from "../src/ui/features/loops/LoopGraphView.js";
import { loopEditorViewStorageKey } from "../src/ui/features/loops/loop-editor-view.js";
import { setTheme } from "../src/ui/shared/theme.js";
import { build, decided, edge, joined, parallel } from "./support/loop-editor-builders.js";
import { project } from "./support/loops-ui.js";
import { stubReactFlowGlobals } from "./support/react-flow.js";

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(loopEditorViewStorageKey, "graph");
  stubReactFlowGlobals();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("dark");
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

const mixed = () =>
  build(["a", "b", "c", "d", "e", "f"], {
    dependencies: [
      edge("a", "b"),
      edge("a", "c"),
      edge("b", "d"),
      edge("c", "d"),
      edge("d", "e"),
      edge("d", "f"),
    ],
    groups: [{ id: "g", name: "G", kind: "parallel", stepIds: ["b", "c"] }],
    grouped: { b: "g", c: "g" },
    joins: [{ stepId: "d", from: ["b", "c"], mode: "any" }],
    decisions: [
      {
        stepId: "d",
        branches: [
          { outcome: "yes", to: "e" },
          { outcome: "no", to: "f" },
        ],
      },
    ],
  });

const graph = () => screen.findByRole("region", { name: "Graph view" });
const edgeNames = () =>
  [...document.querySelectorAll(".react-flow__edge")].map((item) =>
    item.getAttribute("aria-label"),
  );
const disabled = (name: string) => screen.getByRole("button", { name }).hasAttribute("disabled");

const selectEdge = (label: string) => {
  const target = document.querySelector(`.react-flow__edge[aria-label="${label}"]`);
  if (!target) throw new Error(`No edge ${label}`);
  fireEvent.click(target);
  // A real click also moves focus onto the edge, which is what scopes the Delete shortcut.
  if (target instanceof HTMLElement || target instanceof SVGElement) target.focus();
  return target;
};

describe("Graph view rendering", () => {
  it("draws the five stage lanes, a node per step and an edge per dependency", async () => {
    render(editor(createStarterDraft("compact", "starter")));
    await graph();
    for (const lane of ["1. Evidence", "2. Plan", "3. Implementation", "4. Review", "5. Validate"])
      expect(screen.getByRole("heading", { name: lane })).toBeTruthy();
    for (const name of [/^Implement, Implementer/, /^Review, Reviewer/, /^Validate, Validator/])
      expect(screen.getByRole("group", { name })).toBeTruthy();
    expect(edgeNames()).toEqual([
      "Dependency from Implement to Review",
      "Dependency from Review to Validate",
    ]);
  });

  it("shows role, kind, stage and structure badges on a step", async () => {
    render(editor(mixed()));
    await graph();
    const node = screen.getByRole("group", { name: /^b, Role/ });
    expect(within(node).getByText("Role · agent")).toBeTruthy();
    expect(within(node).getByText("3. Implementation")).toBeTruthy();
    expect(within(node).getByText("parallel: G")).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: /^d, Role/ })).getByText("waits for any"),
    ).toBeTruthy();
  });

  it("follows the app theme through the library colour mode", async () => {
    render(editor(parallel()));
    await graph();
    expect(document.querySelector(".react-flow")?.classList.contains("dark")).toBe(false);
    setTheme("dark");
    await vi.waitFor(() =>
      expect(document.querySelector(".react-flow")?.classList.contains("dark")).toBe(true),
    );
  });

  it("keeps the library attribution link at its default", async () => {
    render(editor(parallel()));
    await graph();
    expect(screen.getByRole("link", { name: /React Flow/ }).getAttribute("href")).toBe(
      "https://reactflow.dev/attribution",
    );
  });
});

describe("opening a Board-authored loop in the Graph view", () => {
  it.each([
    ["the three-step starter", () => createStarterDraft("compact", "starter")],
    ["a loop with a parallel group, a join and a decision", mixed],
    ["a join", joined],
    ["a decision", decided],
  ])("draws every dependency of %s and changes nothing", async (_name, make) => {
    const loop = make();
    render(editor(loop));
    await graph();
    expect(edgeNames()).toEqual(
      loop.dependencies.map((item) => {
        const name = (id: string) => loop.steps.find((step) => step.id === id)?.name;
        return `Dependency from ${name(item.from)} to ${name(item.to)}`;
      }),
    );
    expect(disabled("Save draft")).toBe(true);
    expect(disabled("Undo")).toBe(true);
    expect(disabled("Redo")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(disabled("Save draft")).toBe(true);
    expect(disabled("Undo")).toBe(true);
    expect(disabled("Redo")).toBe(true);
  });

  it("opens and closes without writing a position to any step", async () => {
    const apply = vi.fn<(action: (loop: LoopDefinition) => LoopDefinition) => boolean>(() => true);
    render(<LoopGraphView loop={mixed()} apply={apply} openDrawer={() => undefined} />);
    await graph();
    cleanup();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("editing dependencies in the Graph view", () => {
  it("removes a selected connection with Delete and Undo restores it", async () => {
    const user = userEvent.setup();
    render(editor(createStarterDraft("compact", "starter")));
    await graph();
    selectEdge("Dependency from Implement to Review");
    await user.keyboard("{Delete}");
    await vi.waitFor(() => expect(edgeNames()).toEqual(["Dependency from Review to Validate"]));
    expect(disabled("Undo")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await vi.waitFor(() => expect(edgeNames()).toHaveLength(2));
    expect(disabled("Save draft")).toBe(true);
  });

  it("removes a connection from its delete control", async () => {
    const user = userEvent.setup();
    render(editor(createStarterDraft("compact", "starter")));
    await graph();
    selectEdge("Dependency from Review to Validate");
    await user.click(
      await screen.findByRole("button", { name: "Delete: Dependency from Review to Validate" }),
    );
    await vi.waitFor(() => expect(edgeNames()).toEqual(["Dependency from Implement to Review"]));
  });

  it("explains a refused removal inline, keeps the edge and leaves history empty", async () => {
    const user = userEvent.setup();
    render(editor(decided()));
    await graph();
    selectEdge("Dependency from a to b");
    await user.keyboard("{Backspace}");
    expect((await screen.findByRole("alert")).textContent).toContain("fewer than two branches");
    await vi.waitFor(() => expect(edgeNames()).toContain("Dependency from a to b"));
    expect(disabled("Undo")).toBe(true);
    expect(disabled("Save draft")).toBe(true);
  });

  it("never deletes a step with the keyboard", async () => {
    const user = userEvent.setup();
    render(editor(createStarterDraft("compact", "starter")));
    await graph();
    const node = screen.getByRole("group", { name: /^Review, Reviewer/ });
    // Keyboard selection (Enter on the focused node) selects it without opening the drawer.
    node.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Delete}{Backspace}");
    expect(screen.getByRole("group", { name: /^Review, Reviewer/ })).toBeTruthy();
    expect(edgeNames()).toHaveLength(2);
    expect(disabled("Undo")).toBe(true);
  });
});

describe("Delete and Backspace scope", () => {
  it("does nothing while focus is on a toolbar button outside the graph", async () => {
    const user = userEvent.setup();
    render(editor(createStarterDraft("compact", "starter")));
    await graph();
    selectEdge("Dependency from Implement to Review");
    // Undo is disabled, so focus Publish, a button outside the canvas.
    screen.getByRole("button", { name: /^Publish/ }).focus();
    await user.keyboard("{Backspace}{Delete}");
    expect(edgeNames()).toHaveLength(2);
    expect(disabled("Undo")).toBe(true);
  });

  it("never removes an edge while typing in the loop title", async () => {
    const user = userEvent.setup();
    render(editor(createStarterDraft("compact", "starter")));
    await graph();
    selectEdge("Dependency from Implement to Review");
    const title = screen.getByRole("textbox", { name: "Loop title" });
    await user.click(title);
    await user.keyboard("{Backspace}{Backspace}");
    expect(edgeNames()).toHaveLength(2);
    expect((title as HTMLInputElement).value).toBe("Implement → Review → Valida");
  });

  it("deletes the selected edge while focus is inside the canvas", async () => {
    const user = userEvent.setup();
    render(editor(createStarterDraft("compact", "starter")));
    await graph();
    selectEdge("Dependency from Implement to Review");
    await user.keyboard("{Backspace}");
    await vi.waitFor(() => expect(edgeNames()).toEqual(["Dependency from Review to Validate"]));
  });

  it("moves focus to the graph after the delete button removes its edge", async () => {
    const user = userEvent.setup();
    render(editor(createStarterDraft("compact", "starter")));
    await graph();
    selectEdge("Dependency from Review to Validate");
    await user.click(
      await screen.findByRole("button", { name: "Delete: Dependency from Review to Validate" }),
    );
    await vi.waitFor(() => expect(edgeNames()).toHaveLength(1));
    expect(document.activeElement?.classList.contains("react-flow")).toBe(true);
  });
});

describe("step interaction", () => {
  it("opens the step drawer when a node is clicked", async () => {
    render(editor(createStarterDraft("compact", "starter")));
    await graph();
    fireEvent.click(screen.getByRole("group", { name: /^Review, Reviewer/ }));
    const drawer = await screen.findByRole("dialog", { name: "Step configuration" });
    expect((within(drawer).getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe(
      "Review",
    );
  });

  it("does not reseed or loop while the drawer edits a step name", async () => {
    const user = userEvent.setup();
    render(editor(createStarterDraft("compact", "starter")));
    await graph();
    fireEvent.click(screen.getByRole("group", { name: /^Review, Reviewer/ }));
    const title = await screen.findByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Audit");
    await vi.waitFor(() =>
      expect(screen.getByRole("group", { name: /^Audit, Reviewer/, hidden: true })).toBeTruthy(),
    );
  });
});
