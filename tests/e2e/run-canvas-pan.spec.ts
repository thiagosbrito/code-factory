import { expect } from "@playwright/test";
import { finishSetup, test } from "./support/editor-run.js";

test("the run canvas pans by dragging in any direction and zooms with the wheel and buttons", async ({
  page,
  harness,
}) => {
  await finishSetup(page, harness.origin);
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Use starter template" }).click();
  await page
    .getByLabel("Starter templates")
    .getByRole("button", { name: "Create draft" })
    .nth(1)
    .click();
  await page.getByRole("button", { name: "Publish v1" }).click();
  await page.getByRole("button", { name: "Runs" }).click();
  await page.getByRole("button", { name: /New run/i }).click();
  await page.getByLabel(/Task description/).fill("Pan the run canvas");
  await page.getByRole("button", { name: "Start run" }).click();

  const canvas = page.getByRole("region", { name: "Step graph" });
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const zoomLabel = page.getByRole("status").filter({ hasText: /^\d+%$/ });
  const fitView = page.getByRole("button", { name: "Fit view" });
  const node = page.getByRole("button", { name: /Requirements and baseline, pending/ }).first();
  const percent = async () => Number.parseInt((await zoomLabel.textContent()) ?? "0", 10);
  const where = async () => {
    const box = await node.boundingBox();
    if (!box) throw new Error("the step is not on screen");
    return { x: box.x, y: box.y, width: box.width };
  };
  const canvasBox = async () => {
    const box = await canvas.boundingBox();
    if (!box) throw new Error("the canvas has no box");
    return box;
  };
  /** Drags from a point in the empty top-left band of the canvas by (dx, dy). */
  const drag = async (dx: number, dy: number) => {
    const box = await canvasBox();
    const from = { x: box.x + 6, y: box.y + 6 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
    await page.mouse.up();
  };

  // At Fit view, where the whole diagram already shows, dragging still moves it, both ways.
  await expect(fitView).toHaveAttribute("aria-pressed", "true");
  const fitted = await where();
  await drag(60, 40);
  const moved = await where();
  expect(Math.round(moved.x - fitted.x)).toBe(60);
  expect(Math.round(moved.y - fitted.y)).toBe(40);
  await expect(fitView).toHaveAttribute("aria-pressed", "false");
  await drag(-30, -25);
  const back = await where();
  expect(Math.round(back.x - moved.x)).toBe(-30);
  expect(Math.round(back.y - moved.y)).toBe(-25);

  // Fit view puts the diagram back where it started.
  await fitView.click();
  await expect(fitView).toHaveAttribute("aria-pressed", "true");
  const refit = await where();
  expect(Math.abs(refit.x - fitted.x)).toBeLessThan(2);
  expect(Math.abs(refit.y - fitted.y)).toBeLessThan(2);

  // The wheel zooms around the cursor, without scrolling the page.
  const box = await canvasBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const start = await percent();
  await page.mouse.wheel(0, -300);
  await expect.poll(percent).toBeGreaterThan(start);
  const zoomedIn = await percent();
  await page.mouse.wheel(0, 600);
  await expect.poll(percent).toBeLessThan(zoomedIn);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  await expect(fitView).toHaveAttribute("aria-pressed", "false");

  // The buttons zoom too, and a zoomed-in diagram can be dragged around in every direction.
  await fitView.click();
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  for (let step = 0; step < 5; step += 1) await zoomIn.click();
  expect(await percent()).toBeGreaterThan(start);
  const zoomed = await where();
  await drag(-90, -70);
  const dragged = await where();
  expect(Math.round(dragged.x - zoomed.x)).toBe(-90);
  expect(Math.round(dragged.y - zoomed.y)).toBe(-70);

  // Dragging from a step pans without selecting it; a plain click still selects.
  await fitView.click();
  const before = await where();
  const nodeBox = await node.boundingBox();
  if (!nodeBox) throw new Error("the step is not on screen");
  const center = { x: nodeBox.x + nodeBox.width / 2, y: nodeBox.y + nodeBox.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 40, center.y + 30, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Close inspector" })).toHaveCount(0);
  expect(Math.round((await where()).x - before.x)).toBe(40);
  await node.click();
  await expect(page.getByRole("button", { name: "Close inspector" })).toBeVisible();
});
