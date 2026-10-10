import { expect } from "@playwright/test";
import { finishSetup, test } from "./support/editor-run.js";
import { connect, dependency, openStarterInGraph, zoomOf } from "./support/graph.js";

// A tall, wide window keeps the whole canvas on screen at a readable zoom for real pointer drags.
test.use({ viewport: { width: 1600, height: 1200 } });

/**
 * The epic's end-to-end proof: open a loop, switch to Graph, drag a connection, save, reload, and
 * find the same dependency in both views. Fixture providers only; no credentials.
 */
test("a connection dragged in the Graph survives Save and reload, in Graph and Board", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  await expect(dependency(page, "Implement", "Validate")).toHaveCount(0);

  const zoom = await zoomOf(page);
  await connect(page, "Implement", "Validate", { x: -20 * zoom, y: 20 * zoom });
  await expect(dependency(page, "Implement", "Validate")).toHaveCount(1);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved to the project.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Edit draft" }).first().click();

  // The editor remembers the last view; either way, check both explicitly.
  await page.getByRole("button", { name: "Graph" }).click();
  await expect(dependency(page, "Implement", "Validate")).toHaveCount(1);
  await expect(dependency(page, "Implement", "Review")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await page.getByRole("button", { name: "Board" }).click();
  const validate = page
    .getByRole("button", { name: "Validate", exact: true })
    .locator("xpath=ancestor::div[contains(@class,'shadow-sm')][1]");
  await expect(validate).toContainText("After: Review, Implement");
});

test("the Board stays the default and the Graph chunk loads only when asked for", async ({
  page,
  harness,
}) => {
  await finishSetup(page, harness.origin);
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Use starter template" }).click();
  await page
    .getByLabel("Starter templates")
    .getByRole("button", { name: "Create draft" })
    .first()
    .click();
  const graphResources = () =>
    page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        // Built: assets/LoopGraphView-<hash>.js; dev server: .../LoopGraphView.tsx. Not LazyLoopGraphView.
        .filter((name) => /\/LoopGraphView[.-]/.test(name)),
    );
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Graph view" })).toHaveCount(0);
  expect(await graphResources()).toEqual([]);
  await page.getByRole("button", { name: "Graph" }).click();
  await expect(page.getByRole("region", { name: "Graph view" })).toBeVisible();
  expect((await graphResources()).length).toBeGreaterThan(0);
});
