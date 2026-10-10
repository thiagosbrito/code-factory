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
  // This route matches the dev server's module URL for the lazy Graph chunk. A packaged build serves
  // hashed chunk files instead (its failure handling is covered by the Vitest view-switch tests).
  const chunk = "**/loops/LoopGraphView.tsx*";
  let requests = 0;
  await page.route(chunk, async (route) => {
    requests += 1;
    return route.abort();
  });
  const failure = page.getByRole("alert").filter({ hasText: "graph view" });
  await page.getByRole("button", { name: "Graph" }).click();
  await expect(failure).toContainText("could not be loaded");
  await expect(failure).toContainText(
    "Try again; if it keeps failing, save the draft and reload the page.",
  );
  expect(requests).toBe(1);
  // Whether Chromium asks the network again for a failed module URL is its own business (it can
  // serve the remembered failure), so the outcome is asserted instead: Retry tries once more, the
  // graph still cannot load, and focus moves from the switch to the fresh alert, which pressing
  // Retry alone could never do.
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(failure).toBeFocused();
  expect(requests).toBeLessThanOrEqual(2);
  await expect(page.getByRole("region", { name: "Graph view" })).toHaveCount(0);

  await page.getByRole("button", { name: "Use the Board" }).click();
  await expect(page.getByRole("button", { name: "Board" })).toBeFocused();
  await page.getByRole("textbox", { name: "Loop title" }).fill("Still editable");
  await expect(page.getByRole("textbox", { name: "Loop title" })).toHaveValue("Still editable");

  // Choosing Graph again imports again (the failed attempt is not remembered by the app).
  await page.getByRole("button", { name: "Graph" }).click();
  await expect(failure).toContainText("could not be loaded");
  await page.unroute(chunk);
  await page.reload();
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Edit draft" }).first().click();
  await expect(page.getByRole("region", { name: "Graph view" })).toBeVisible();
});
