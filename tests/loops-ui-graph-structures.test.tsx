// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LoopDefinition } from "../src/domain/loop.js";
import { LoopEditor } from "../src/ui/features/loops/LoopEditor.js";
import LoopGraphView from "../src/ui/features/loops/LoopGraphView.js";
import { loopEditorViewStorageKey } from "../src/ui/features/loops/loop-editor-view.js";
import { setTheme } from "../src/ui/shared/theme.js";
import { structured } from "./support/loop-editor-builders.js";
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

const graph = () => screen.findByRole("region", { name: "Graph view" });
const disabled = (name: string) => screen.getByRole("button", { name }).hasAttribute("disabled");
const node = (id: string) => screen.getByRole("group", { name: new RegExp(`^${id}, Role`) });
const edgeOf = (label: string) => {
  const found = document.querySelector(`.react-flow__edge[aria-label="${label}"]`);
  if (!found) throw new Error(`No edge ${label}`);
  return found;
};
const dependencyCount = () =>
  document.querySelectorAll('.react-flow__edge[aria-label^="Dependency from"]').length;

const selectEdge = (label: string) => {
  const target = edgeOf(label);
  fireEvent.click(target);
  if (target instanceof HTMLElement || target instanceof SVGElement) target.focus();
};

describe.each(["light", "dark"] as const)("structures in the Graph view (%s theme)", (theme) => {
  beforeEach(() => setTheme(theme));

  it("draws each group as one labelled region, dashed for parallel and solid for repeat", async () => {
    render(editor(structured()));
    await graph();
    const parallel = screen.getByText("Parallel group: Fan");
    const repeat = screen.getByText("Repeat group: Again (max 3 iterations)");
    expect(parallel.parentElement?.classList.contains("graph-region-parallel")).toBe(true);
    expect(repeat.parentElement?.classList.contains("graph-region-repeat")).toBe(true);
    expect(document.querySelectorAll(".graph-region")).toHaveLength(2);
    expect(document.querySelector(".react-flow")?.classList.contains("dark")).toBe(
      theme === "dark",
    );
  });

  it("shows the join mode on its target and an outcome label on each decision branch", async () => {
    render(editor(structured()));
    await graph();
    expect(within(node("j")).getByText("waits for any")).toBeTruthy();
    expect(within(node("z")).getByText("decision: pass / fail")).toBeTruthy();
    const labels = [...document.querySelectorAll(".graph-outcome-label")].map(
      (item) => item.textContent,
    );
    expect(labels.sort()).toEqual(["done", "fail", "pass"]);
  });

  it("draws the join's incoming connections apart from the others", async () => {
    render(editor(structured()));
    await graph();
    for (const label of ["Dependency from b to j", "Dependency from c to j"])
      expect(edgeOf(label).classList.contains("graph-edge-join")).toBe(true);
    expect(edgeOf("Dependency from s to b").classList.contains("graph-edge-join")).toBe(false);
  });
});

describe("a repeat group's continuation", () => {
  it("is drawn as a labelled back arrow that is not a dependency", async () => {
    render(editor(structured()));
    await graph();
    const arrow = document.querySelector('.react-flow__edge[aria-label^="Repeat group Again"]');
    expect(arrow?.getAttribute("aria-label")).toContain("View only");
    expect(document.querySelector(".graph-continue-label")?.textContent).toBe("again (repeat)");
    expect(dependencyCount()).toBe(structured().dependencies.length);
  });

  it("cannot be selected or deleted", async () => {
    const user = userEvent.setup();
    render(editor(structured()));
    await graph();
    const arrow = document.querySelector('.react-flow__edge[aria-label^="Repeat group Again"]');
    if (!arrow) throw new Error("no continuation");
    fireEvent.click(arrow);
    expect(arrow.classList.contains("selected")).toBe(false);
    expect(screen.queryByRole("button", { name: /^Delete:/ })).toBeNull();
    await user.keyboard("{Delete}{Backspace}");
    expect(dependencyCount()).toBe(structured().dependencies.length);
    expect(disabled("Undo")).toBe(true);
    expect(
      document.querySelector('.react-flow__edge[aria-label^="Repeat group Again"]'),
    ).toBeTruthy();
  });
});

describe("connections that touch constrained steps", () => {
  it("disables starting a connection at a decision and says why, pointing to the Board view", async () => {
    render(editor(structured()));
    await graph();
    const handle = node("z").querySelector(".react-flow__handle.source");
    expect(handle?.getAttribute("aria-disabled")).toBe("true");
    expect(handle?.getAttribute("title")).toContain(
      "Decision step: add a named branch in the Board view",
    );
    expect(handle?.getAttribute("title")).toContain("Step z is a decision.");
    expect(handle?.getAttribute("aria-label")).toBe(handle?.getAttribute("title"));
  });

  it("leaves the output handle of an ordinary step and of a join target enabled", async () => {
    render(editor(structured()));
    await graph();
    for (const id of ["s", "j"]) {
      const handle = node(id).querySelector(".react-flow__handle.source");
      expect(handle?.getAttribute("aria-disabled")).toBeNull();
      expect(handle?.getAttribute("title")).toBeNull();
    }
  });

  it("describes group membership and joins to assistive technology", async () => {
    render(editor(structured()));
    await graph();
    expect(within(node("b")).getByText(/cannot be ordered with each other/)).toBeTruthy();
    expect(
      within(node("j")).getByText(/waits for any of b, c\. Edit it in the Board view/),
    ).toBeTruthy();
  });
});

describe("confirming a change with a warning", () => {
  const removeJoinSource = async () => {
    const user = userEvent.setup();
    render(editor(structured()));
    await graph();
    selectEdge("Dependency from b to j");
    await user.keyboard("{Delete}");
    return { user, dialog: await screen.findByRole("dialog", { name: "Apply this change?" }) };
  };

  it("asks first, and Cancel changes nothing and keeps history empty", async () => {
    const { user, dialog } = await removeJoinSource();
    expect(within(dialog).getByText(/fewer than two sources/)).toBeTruthy();
    expect(dependencyCount()).toBe(structured().dependencies.length);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(dependencyCount()).toBe(structured().dependencies.length);
    expect(disabled("Undo")).toBe(true);
    expect(disabled("Save draft")).toBe(true);
    expect(document.activeElement?.classList.contains("react-flow")).toBe(true);
  });

  it("starts on Cancel and Escape also cancels", async () => {
    const { user } = await removeJoinSource();
    expect(document.activeElement?.textContent).toBe("Cancel");
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(dependencyCount()).toBe(structured().dependencies.length);
    expect(disabled("Undo")).toBe(true);
  });

  it("Confirm applies the change as one undo entry that Undo reverses", async () => {
    const { user, dialog } = await removeJoinSource();
    await user.click(within(dialog).getByRole("button", { name: "Apply change" }));
    await vi.waitFor(() => expect(dependencyCount()).toBe(structured().dependencies.length - 1));
    expect(within(node("j")).queryByText("waits for any")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await vi.waitFor(() => expect(dependencyCount()).toBe(structured().dependencies.length));
    expect(within(node("j")).getByText("waits for any")).toBeTruthy();
    expect(disabled("Undo")).toBe(true);
    expect(disabled("Save draft")).toBe(true);
  });

  it("applies a removal without warnings straight away", async () => {
    const user = userEvent.setup();
    render(editor(structured()));
    await graph();
    selectEdge("Dependency from s to b");
    await user.keyboard("{Delete}");
    await vi.waitFor(() => expect(dependencyCount()).toBe(structured().dependencies.length - 1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("opening a structured loop writes nothing", () => {
  it("leaves Save, Undo and Redo disabled and sends no request, in the Graph and after a Board round trip", async () => {
    const fetchSpy = vi.fn<(input: string, init?: RequestInit) => Promise<never>>(
      () => new Promise(() => undefined),
    );
    vi.stubGlobal("fetch", fetchSpy);
    render(editor(structured()));
    await graph();
    expect(document.querySelectorAll(".graph-region")).toHaveLength(2);
    for (const name of ["Save draft", "Undo", "Redo"]) expect(disabled(name)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    for (const name of ["Save draft", "Undo", "Redo"]) expect(disabled(name)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    await graph();
    for (const name of ["Save draft", "Undo", "Redo"]) expect(disabled(name)).toBe(true);
    // The editor may read (GET) on mount; nothing may be written.
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method && init.method !== "GET")).toEqual(
      [],
    );
  });

  it("never calls apply while drawing regions, badges, labels and the back arrow", async () => {
    const apply = vi.fn<(action: (loop: LoopDefinition) => LoopDefinition) => boolean>(() => true);
    render(<LoopGraphView loop={structured()} apply={apply} openDrawer={() => undefined} />);
    await graph();
    expect(document.querySelectorAll(".graph-region")).toHaveLength(2);
    cleanup();
    expect(apply).not.toHaveBeenCalled();
  });
});
