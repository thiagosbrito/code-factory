import { expect } from "@playwright/test";
import { test } from "./support/editor-run.js";
import { dependency, openStarterInGraph, stepNode } from "./support/graph.js";

test.use({ viewport: { width: 1600, height: 1200 } });

const announcements = (page: import("@playwright/test").Page) =>
  page.getByLabel("Graph announcements");

test("a dependency can be added and removed with the keyboard alone, and shows on the Board", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  await expect(dependency(page, "Implement", "Validate")).toHaveCount(0);

  // Connect: focus a step, C, move to the target, Enter.
  await stepNode(page, "Implement").focus();
  await page.keyboard.press("c");
  const connect = page.getByRole("dialog", { name: "Connect Implement to…" });
  await expect(connect).toBeVisible();
  await connect.getByRole("button", { name: /^Validate/ }).focus();
  await page.keyboard.press("Enter");
  await expect(dependency(page, "Implement", "Validate")).toHaveCount(1);
  await expect(announcements(page)).toContainText("Connected Implement to Validate");
  await expect(stepNode(page, "Implement")).toBeFocused();

  // The same dependency is on the Board, as a predecessor of Validate.
  await page.getByRole("button", { name: "Board" }).click();
  const validateCard = page
    .getByRole("button", { name: "Validate", exact: true })
    .locator("xpath=ancestor::div[contains(@class,'shadow-sm')][1]");
  await expect(validateCard).toContainText("After: Review, Implement");
  await page.getByRole("button", { name: "Graph" }).click();

  // Disconnect it again, also by keyboard.
  await stepNode(page, "Implement").focus();
  await page.keyboard.press("d");
  const disconnect = page.getByRole("dialog", { name: "Disconnect Implement" });
  await disconnect.getByRole("button", { name: "Remove Implement → Validate" }).focus();
  await page.keyboard.press("Enter");
  await expect(dependency(page, "Implement", "Validate")).toHaveCount(0);
  await expect(announcements(page)).toContainText("Disconnected Implement from Validate");
});

test("a refused connection is read out with the reason shown, and Escape closes the dialog", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  await stepNode(page, "Validate").focus();
  await page.keyboard.press("c");
  const dialog = page.getByRole("dialog", { name: "Connect Validate to…" });
  const implement = dialog.getByRole("button", { name: /^Implement/ });
  await expect(implement).toContainText("Dependency cycles are not allowed");
  await implement.focus();
  await page.keyboard.press("Enter");
  await expect(announcements(page)).toContainText("Dependency cycles are not allowed");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(stepNode(page, "Validate")).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("Enter opens the step drawer and Alt with an arrow moves focus between steps", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  await stepNode(page, "Implement").focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(stepNode(page, "Review")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Step configuration" })).toBeVisible();
});
