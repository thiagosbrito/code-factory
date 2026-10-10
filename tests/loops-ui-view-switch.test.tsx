// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStarterDraft } from "../src/domain/starter-templates.js";
import { LoopEditor } from "../src/ui/features/loops/LoopEditor.js";
import { LazyLoopGraphView } from "../src/ui/features/loops/LazyLoopGraphView.js";
import { loopEditorViewStorageKey } from "../src/ui/features/loops/loop-editor-view.js";
import { draft, project } from "./support/loops-ui.js";
import { stubReactFlowGlobals } from "./support/react-flow.js";

beforeEach(() => {
  window.localStorage.clear();
  stubReactFlowGlobals();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/ui/features/loops/LoopGraphView");
  vi.resetModules();
});

const editor = (initial = draft()) => (
  <LoopEditor
    initial={initial}
    project={project}
    agents={[]}
    onBack={() => undefined}
    onPublished={async () => undefined}
  />
);

const inertEditor = { apply: () => false, openDrawer: () => undefined };
const graphButton = () => screen.getByRole("button", { name: "Graph" });
const boardButton = () => screen.getByRole("button", { name: "Board" });
const graphView = () => screen.findByRole("region", { name: "Graph view" });

describe("loop editor Board/Graph switch", () => {
  it("shows the Board by default with an accessible view control", () => {
    render(editor());
    expect(screen.getByRole("group", { name: "Editor view" })).toBeTruthy();
    expect(boardButton().getAttribute("aria-pressed")).toBe("true");
    expect(graphButton().getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Build" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Graph view" })).toBeNull();
  });

  it("is operable with Tab, Enter and Space", async () => {
    const user = userEvent.setup();
    render(editor());
    graphButton().focus();
    await user.keyboard("{Enter}");
    await graphView();
    expect(graphButton().getAttribute("aria-pressed")).toBe("true");
    boardButton().focus();
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Build" })).toBeTruthy();
    expect(boardButton().getAttribute("aria-pressed")).toBe("true");
    await user.tab();
    expect(document.activeElement).toBe(graphButton());
  });

  it("keeps unsaved edits, the open drawer and undo history across a switch", async () => {
    const user = userEvent.setup();
    render(editor());
    const title = screen.getByRole("textbox", { name: "Loop title" });
    await user.clear(title);
    await user.type(title, "Renamed");
    await user.click(screen.getByRole("button", { name: "Build" }));
    expect(screen.getByRole("dialog", { name: "Step configuration" })).toBeTruthy();
    // The modal drawer hides the view switch from users (correct modal behaviour), so this
    // test drives the switch with fireEvent to prove the drawer state survives the switch.
    fireEvent.click(screen.getByRole("button", { name: "Graph", hidden: true }));
    await screen.findByRole("region", { name: "Graph view", hidden: true });
    expect(screen.getByRole("dialog", { name: "Step configuration" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Board", hidden: true }));
    expect(screen.getByRole("dialog", { name: "Step configuration" })).toBeTruthy();
    expect(
      (screen.getByRole("textbox", { name: "Loop title", hidden: true }) as HTMLInputElement).value,
    ).toBe("Renamed");
    expect(
      screen.getByRole("button", { name: "Save draft", hidden: true }).hasAttribute("disabled"),
    ).toBe(false);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect((screen.getByRole("textbox", { name: "Loop title" }) as HTMLInputElement).value).toBe(
      "Rename",
    );
  });

  it("undoes the previous edit after switching views", async () => {
    const user = userEvent.setup();
    render(editor());
    const title = screen.getByRole("textbox", { name: "Loop title" });
    await user.type(title, "!");
    await user.click(graphButton());
    await graphView();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect((screen.getByRole("textbox", { name: "Loop title" }) as HTMLInputElement).value).toBe(
      "Sample",
    );
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect((screen.getByRole("textbox", { name: "Loop title" }) as HTMLInputElement).value).toBe(
      "Sample!",
    );
  });

  it("leaves a loop with a group, join and decision untouched when switching", async () => {
    const user = userEvent.setup();
    const staged = createStarterDraft("staged", "staged");
    expect(staged.groups.length).toBeGreaterThan(0);
    expect(staged.joins.length).toBeGreaterThan(0);
    expect(staged.decisions.length).toBeGreaterThan(0);
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
      requests.push(`${options?.method ?? "GET"} ${path}`);
      if (path === "/api/native/formats") return Response.json({ formats: [] });
      throw new Error(`Unexpected ${path}`);
    });
    render(editor(staged));
    await user.click(graphButton());
    await graphView();
    await user.click(boardButton());
    expect(screen.getByRole("button", { name: "Save draft" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled")).toBe(true);
    expect(requests.filter((request) => !request.endsWith("/api/native/formats"))).toEqual([]);
    expect(screen.getByRole("textbox", { name: "Loop title" })).toHaveProperty(
      "value",
      staged.name,
    );
    for (const step of staged.steps)
      expect(screen.getAllByRole("button", { name: step.name }).length).toBeGreaterThan(0);
  });

  it("remembers the choice across remounts", async () => {
    const user = userEvent.setup();
    const first = render(editor());
    await user.click(graphButton());
    await graphView();
    expect(window.localStorage.getItem(loopEditorViewStorageKey)).toBe("graph");
    first.unmount();
    render(editor());
    expect(graphButton().getAttribute("aria-pressed")).toBe("true");
    await graphView();
  });

  it("stays on the Board and does not throw when storage is blocked", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(editor());
    expect(boardButton().getAttribute("aria-pressed")).toBe("true");
    await user.click(graphButton());
    await graphView();
  });
});

describe("lazy graph view failure", () => {
  it("shows an error with Retry, offers the Board, and recovers when the import succeeds", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const module = await import("../src/ui/features/loops/LoopGraphView.js");
    const load = vi
      .fn<() => Promise<typeof module>>()
      .mockRejectedValueOnce(new Error("chunk 404"))
      .mockResolvedValue(module);
    const onUseBoard = vi.fn<() => void>();
    render(
      <LazyLoopGraphView loop={draft()} {...inertEditor} onUseBoard={onUseBoard} load={load} />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("could not be loaded");
    await user.click(screen.getByRole("button", { name: "Use the Board" }));
    expect(onUseBoard).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await graphView();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps the editor usable on the Board when the chunk fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.localStorage.setItem(loopEditorViewStorageKey, "graph");
    vi.doMock("../src/ui/features/loops/LoopGraphView", () => {
      throw new Error("chunk 404");
    });
    vi.resetModules();
    const { LoopEditor: FreshEditor } = await import("../src/ui/features/loops/LoopEditor.js");
    render(
      <FreshEditor
        initial={draft()}
        project={project}
        agents={[]}
        onBack={() => undefined}
        onPublished={async () => undefined}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("could not be loaded");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(document.activeElement).toBe(graphButton());
    await user.click(await screen.findByRole("button", { name: "Use the Board" }));
    await waitFor(() => expect(document.activeElement).toBe(boardButton()));
    await waitFor(() => expect(screen.getByRole("button", { name: "Build" })).toBeTruthy());
    expect(boardButton().getAttribute("aria-pressed")).toBe("true");
    const title = screen.getByRole("textbox", { name: "Loop title" });
    await user.type(title, "x");
    expect((title as HTMLInputElement).value).toBe("Samplex");
  });

  it("does not show the loading fallback again once the graph view has loaded", async () => {
    const user = userEvent.setup();
    const module = await import("../src/ui/features/loops/LoopGraphView.js");
    const load = vi.fn<() => Promise<typeof module>>().mockResolvedValue(module);
    const view = (
      <LazyLoopGraphView loop={draft()} {...inertEditor} onUseBoard={() => undefined} load={load} />
    );
    const first = render(view);
    await graphView();
    first.unmount();
    render(view);
    expect(screen.getByRole("region", { name: "Graph view" })).toBeTruthy();
    expect(screen.queryByText("Loading graph view…")).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    cleanup();
    // Same through the editor: Graph, Board, Graph again renders immediately.
    render(editor());
    await user.click(graphButton());
    await graphView();
    await user.click(boardButton());
    await user.click(graphButton());
    expect(screen.getByRole("region", { name: "Graph view" })).toBeTruthy();
    expect(screen.queryByText("Loading graph view…")).toBeNull();
  });
});
