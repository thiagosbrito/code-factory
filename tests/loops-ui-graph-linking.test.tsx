// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStarterDraft } from "../src/domain/starter-templates.js";
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
    expect(announced()).toContain(cycle);
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

  it("moves focus to the neighbouring step with Alt and an arrow, and says which", async () => {
    const user = userEvent.setup();
    await open();
    step("Implement").focus();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(document.activeElement).toBe(step("Review"));
    expect(announced()).toBe("Review");
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(document.activeElement).toBe(step("Implement"));
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(announced()).toBe("No step that way");
    expect(disabled("Undo")).toBe(true);
  });

  it("does not treat C or D as shortcuts while typing in a field", async () => {
    const user = userEvent.setup();
    await open();
    await user.type(screen.getByRole("textbox", { name: "Loop title" }), "cd");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
