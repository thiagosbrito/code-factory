import { expect } from "@playwright/test";
import { finishSetup, test } from "./support/editor-run.js";

test("the Board/Graph choice survives a reload and switching back restores the Board", async ({
  page,
  harness,
}) => {
  await finishSetup(page, harness.origin);
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Create empty loop" }).first().click();
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("textbox", { name: "Loop title" }).fill("Switch loop");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Graph" }).click();
  await expect(page.getByRole("region", { name: "Graph view" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Loop title" })).toHaveValue("Switch loop");

  await page.reload();
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Edit draft" }).first().click();
  await expect(page.getByRole("button", { name: "Graph" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Graph view" })).toBeVisible();

  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByRole("region", { name: "Graph view" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Loop title" })).toBeVisible();
});

test("a failed graph chunk shows an error, keeps the Board usable and a reload recovers", async ({
  page,
  harness,
}) => {
  await finishSetup(page, harness.origin);
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Create empty loop" }).first().click();
  await page.getByRole("textbox", { name: "Loop title" }).fill("Failure loop");
  await page.getByRole("button", { name: "Save draft" }).click();
  let aborted = false;
  await page.route("**/loops/LoopGraphView.tsx*", async (route) => {
    if (aborted) return route.continue();
    aborted = true;
    return route.abort();
  });
  await page.getByRole("button", { name: "Graph" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "graph view" })).toContainText(
    "could not be loaded",
  );
  // Chromium remembers a failed module URL for the page's lifetime, so Retry cannot fetch it
  // again here (it can for failures the browser did not cache); the error stays with a hint.
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "graph view" })).toContainText(
    "reload the page",
  );

  await page.getByRole("button", { name: "Use the Board" }).click();
  await expect(page.getByRole("button", { name: "Board" })).toBeFocused();
  await page.getByRole("textbox", { name: "Loop title" }).fill("Still editable");
  await expect(page.getByRole("textbox", { name: "Loop title" })).toHaveValue("Still editable");

  await page.getByRole("button", { name: "Graph" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Edit draft" }).first().click();
  await expect(page.getByRole("region", { name: "Graph view" })).toBeVisible();
});
