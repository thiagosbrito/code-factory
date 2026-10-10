import { expect } from "@playwright/test";
import { test } from "./support/editor-run.js";
import { openStarterInGraph, zoomOf } from "./support/graph.js";

// A phone-sized window: the editor stacks, the sidebar is stacked above the page, the help folds.
test.use({ viewport: { width: 390, height: 844 } });

test("the Graph is usable on a phone-sized window, and a saved rail never strands it", async ({
  page,
  harness,
}) => {
  // A rail saved on a desktop must not apply here, where the toggle is hidden.
  await page.addInitScript(() =>
    window.localStorage.setItem("code-factory.sidebar-collapsed", "true"),
  );
  await openStarterInGraph(page, harness.origin);
  await expect(page.getByRole("region", { name: "Graph view" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Factory" }).getByText("Loops")).toBeVisible();
  // The canvas keeps a readable zoom instead of shrinking the whole graph into the window.
  expect(await zoomOf(page)).toBeGreaterThanOrEqual(0.6);
  // The long help is folded behind a summary, so it does not push the canvas off screen.
  await expect(page.getByText("How to use the Graph")).toBeVisible();
  await expect(page.getByText(/Drag from a step/).first()).toBeHidden();
  await page.getByText("How to use the Graph").click();
  await expect(page.getByText(/Drag from a step/).last()).toBeVisible();
  // Nothing makes the page itself scroll sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
