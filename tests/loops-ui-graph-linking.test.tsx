// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStarterDraft } from "../src/domain/starter-templates.js";
import { joined, repeated } from "./support/loop-editor-builders.js";
import type { LoopDefinition } from "../src/domain/loop.js";
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

const editor = (initial: LoopDefinition) => (
  <LoopEditor
    initial={initial}
    project={project}
    agents={[]}
    onBack={() => undefined}
    onPublished={async () => undefined}
  />
);

const open = async () => {
  render(editor(createStarterDraft("compact", "starter")));
  await screen.findByRole("region", { name: "Graph view" });
};
const step = (name: string) => screen.getByRole("group", { name: new RegExp(`^${name}, `, "u") });
const edgeNames = () =>
  [...document.querySelectorAll(".react-flow__edge")].map((item) =>
    item.getAttribute("aria-label"),
  );
// While a dialog is open the page behind it is hidden from the accessibility tree, so these
// lookups include hidden elements.
const announced = () =>
  screen.getByLabelText("Graph announcements").textContent?.replaceAll("\u00a0", "");
const disabled = (name: string) =>
  screen.getByRole("button", { name, hidden: true }).hasAttribute("disabled");
const connectOnly = "Dependency from Implement to Validate";

describe("keyboard linking in the Graph view", () => {
  it("connects two steps from the keyboard, announces it, and one Undo removes it", async () => {
    const user = userEvent.setup();
    await open();
    expect(edgeNames()).not.toContain(connectOnly);
    step("Implement").focus();
    await user.keyboard("c");
    const dialog = await screen.findByRole("dialog", { name: "Connect Implement to…" });
    await user.click(within(dialog).getByRole("button", { name: /^Validate/u }));
    expect(announced()).toBe("Connected Implement to Validate");
    expect(edgeNames()).toContain(connectOnly);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Focus returns to the step the dialog was opened from.
    expect(document.activeElement).toBe(step("Implement"));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(edgeNames()).not.toContain(connectOnly);
    expect(disabled("Undo")).toBe(true);
  });

  it("says why a connection is refused, in the list, announced and inline, and records nothing", async () => {
    const user = userEvent.setup();
    await open();
    step("Validate").focus();
    await user.keyboard("c");
    const dialog = await screen.findByRole("dialog", { name: "Connect Validate to…" });
    const implement = within(dialog).getByRole("button", { name: /^Implement/u });
    const cycle = "Dependency cycles are not allowed";
    expect(implement.textContent).toContain(cycle);
    expect(implement.getAttribute("aria-disabled")).toBe("true");
    await user.click(implement);
    // The reason is read out where a screen reader can reach it: inside the open dialog.
    expect(within(dialog).getByRole("status").textContent).toContain(cycle);
    expect(screen.getByRole("alert", { hidden: true }).textContent).toContain(cycle);
    // The dialog stays open so another target can be chosen; nothing was added.
    expect(screen.getByRole("dialog", { name: "Connect Validate to…" })).toBeTruthy();
    expect(disabled("Undo")).toBe(true);
    expect(edgeNames()).toHaveLength(2);
  });

  it("lists an existing connection as already connected and does not add it twice", async () => {
    const user = userEvent.setup();
    await open();
    step("Implement").focus();
    await user.keyboard("c");
    const dialog = await screen.findByRole("dialog", { name: "Connect Implement to…" });
    const review = within(dialog).getByRole("button", { name: /^Review/u });
    expect(review.textContent).toContain("Already connected");
    await user.click(review);
    expect(within(dialog).getByRole("status").textContent).toBe("Already connected");
    expect(edgeNames()).toHaveLength(2);
    expect(disabled("Undo")).toBe(true);
  });

  it("disconnects from the keyboard, announces it, and Undo restores the connection", async () => {
    const user = userEvent.setup();
    await open();
    step("Implement").focus();
    await user.keyboard("d");
    const dialog = await screen.findByRole("dialog", { name: "Disconnect Implement" });
    await user.click(within(dialog).getByRole("button", { name: "Remove Implement → Review" }));
    expect(announced()).toBe("Disconnected Implement from Review");
    expect(edgeNames()).not.toContain("Dependency from Implement to Review");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(edgeNames()).toContain("Dependency from Implement to Review");
  });

  it("offers Connect and Disconnect on a toolbar once exactly one step is selected", async () => {
    const user = userEvent.setup();
    await open();
    expect(disabled("Connect to…")).toBe(true);
    expect(disabled("Disconnect…")).toBe(true);
    step("Review").focus();
    await user.keyboard(" ");
    expect(screen.getByText("Selected: Review")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Connect to…" }));
    expect(await screen.findByRole("dialog", { name: "Connect Review to…" })).toBeTruthy();
  });

  it("opens the step drawer with Enter on a focused step", async () => {
    const user = userEvent.setup();
    await open();
    step("Review").focus();
    await user.keyboard("{Enter}");
    const drawer = await screen.findByRole("dialog", { name: "Step configuration" });
    expect(within(drawer).getByRole("textbox", { name: "Title" })).toHaveProperty(
      "value",
      "Review",
    );
  });

  it("moves focus to the neighbouring step with Alt and an arrow, and says when there is none", async () => {
    const user = userEvent.setup();
    await open();
    step("Implement").focus();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    // Focus moving is announced by the card's own label; no extra speech is added.
    expect(document.activeElement).toBe(step("Review"));
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(document.activeElement).toBe(step("Implement"));
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(announced()).toBe("No step that way");
    expect(disabled("Undo")).toBe(true);
  });

  it("leaves Ctrl and Meta arrows to the browser and the screen reader", async () => {
    await open();
    step("Implement").focus();
    for (const modifier of ["ctrlKey", "metaKey"] as const)
      expect(fireEvent.keyDown(step("Implement"), { key: "ArrowRight", [modifier]: true })).toBe(
        true,
      );
    expect(document.activeElement).toBe(step("Implement"));
  });

  it("does not treat C or D as shortcuts from a field or button inside a step card", async () => {
    await open();
    const card = step("Implement");
    const field = document.createElement("input");
    const button = document.createElement("button");
    card.append(field, button);
    for (const target of [field, button]) {
      expect(fireEvent.keyDown(target, { key: "c" })).toBe(true);
      expect(fireEvent.keyDown(target, { key: "Enter" })).toBe(true);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
    // The same keys on the card itself do act, so the guard is what held them back.
    expect(fireEvent.keyDown(card, { key: "c" })).toBe(false);
    expect(await screen.findByRole("dialog", { name: "Connect Implement to…" })).toBeTruthy();
  });

  it("opens Connect and Disconnect with Caps Lock on or a non-Latin layout", async () => {
    await open();
    fireEvent.keyDown(step("Implement"), { key: "C", code: "KeyC" });
    expect(await screen.findByRole("dialog", { name: "Connect Implement to…" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.keyDown(step("Implement"), { key: "в", code: "KeyD" });
    expect(await screen.findByRole("dialog", { name: "Disconnect Implement" })).toBeTruthy();
  });

  it("ends the dialog when Undo removes its step, and Redo does not bring it back", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Add step to 2. Plan" }));
    const added = step("New agent step");
    added.focus();
    await user.keyboard("c");
    await screen.findByRole("dialog", { name: "Connect New agent step to…" });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("keyboard linking on structured loops", () => {
  const openLoop = async (loop: LoopDefinition) => {
    render(editor(loop));
    await screen.findByRole("region", { name: "Graph view" });
  };

  it("shows why a removal is refused, up front and in the dialog, and changes nothing", async () => {
    const user = userEvent.setup();
    await openLoop(repeated());
    step("c").focus();
    await user.keyboard("d");
    const dialog = await screen.findByRole("dialog", { name: "Disconnect c" });
    const exit = within(dialog).getByRole("button", { name: /Remove c → d/u });
    expect(exit.getAttribute("aria-disabled")).toBe("true");
    const reason = exit.textContent?.replace("Remove c → d", "") ?? "";
    expect(reason.length).toBeGreaterThan(0);
    await user.click(exit);
    expect(within(dialog).getByRole("status").textContent).toBe(reason);
    expect(disabled("Undo")).toBe(true);
  });

  it("asks before a removal that collapses a join, then announces it and returns focus", async () => {
    const user = userEvent.setup();
    await openLoop(joined());
    step("b").focus();
    await user.keyboard("d");
    const dialog = await screen.findByRole("dialog", { name: "Disconnect b" });
    await user.click(within(dialog).getByRole("button", { name: "Remove b → d" }));
    const confirm = await screen.findByRole("dialog", { name: "Apply this change?" });
    await user.click(within(confirm).getByRole("button", { name: "Apply change" }));
    await vi.waitFor(() => expect(announced()).toBe("Disconnected b from d"));
    expect(document.activeElement).toBe(step("b"));
    expect(edgeNames()).not.toContain("Dependency from b to d");
  });

  it("changes nothing and returns focus when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    await openLoop(joined());
    step("b").focus();
    await user.keyboard("d");
    await user.click(
      within(await screen.findByRole("dialog", { name: "Disconnect b" })).getByRole("button", {
        name: "Remove b → d",
      }),
    );
    const confirm = await screen.findByRole("dialog", { name: "Apply this change?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() => expect(document.activeElement).toBe(step("b")));
    expect(edgeNames()).toContain("Dependency from b to d");
    expect(disabled("Undo")).toBe(true);
  });
});
