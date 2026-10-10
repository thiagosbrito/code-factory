import { expect } from "@playwright/test";
import { test } from "./support/editor-run.js";
import { openStarterInGraph } from "./support/graph.js";

test.use({ viewport: { width: 1600, height: 1200 } });

test("collapsing the main sidebar widens the editor canvas and is remembered after reload", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  const graph = page.getByRole("region", { name: "Graph view" });
  const expanded = (await graph.boundingBox())?.width ?? 0;

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect
    .poll(async () => (await graph.boundingBox())?.width ?? 0)
    .toBeGreaterThan(expanded + 100);
  // The rail keeps navigation, and the canvas is still usable.
  await expect(
    page.getByRole("navigation", { name: "Factory" }).getByRole("button", { name: "Loops" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "3. Implementation" })).toBeVisible();

  // Every rail control shares one vertical axis: the theme toggle is not pushed to the right.
  const axis = async (name: string | RegExp) => {
    const box = await page.getByRole("button", { name }).boundingBox();
    return Math.round((box?.x ?? 0) + (box?.width ?? 0) / 2);
  };
  const runs = await axis(/^Runs/);
  expect(await axis(/^Switch to/)).toBe(runs);
  expect(await axis("Expand sidebar")).toBe(runs);

  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
});
