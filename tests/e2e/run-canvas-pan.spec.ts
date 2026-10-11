import { expect } from "@playwright/test";
import { finishSetup, test } from "./support/editor-run.js";

test("the run canvas pans by dragging and zooms only with its buttons", async ({
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
  const zoomLabel = page.getByRole("status").filter({ hasText: /^\d+%$/ });
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  for (let step = 0; step < 6; step += 1) await zoomIn.click();
  const zoomed = await zoomLabel.textContent();

  const scrollOf = () => canvas.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
  const overflow = await canvas.evaluate((el) => ({
    x: el.scrollWidth - el.clientWidth,
    y: el.scrollHeight - el.clientHeight,
  }));
  expect(overflow.x).toBeGreaterThan(200);

  // The wheel scrolls the page or canvas; it never changes the zoom.
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the canvas has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -400);
  await page.keyboard.up("Control");
  await expect(zoomLabel).toHaveText(zoomed ?? "");

  // Dragging empty canvas moves the diagram: dragging left reveals what is to the right.
  const before = await scrollOf();
  const start = { x: box.x + box.width / 2, y: box.y + 8 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 120, start.y - 0, { steps: 6 });
  await page.mouse.move(start.x - 240, start.y, { steps: 6 });
  await page.mouse.up();
  const dragged = await scrollOf();
  expect(dragged.left - before.left).toBeGreaterThan(150);

  // And back the other way.
  await page.mouse.move(box.x + 24, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 24 + 200, box.y + 12, { steps: 8 });
  await page.mouse.up();
  expect((await scrollOf()).left).toBeLessThan(dragged.left - 100);

  // Dragging from a node pans too and does not select the node; a plain click still does.
  const node = page.getByRole("button", { name: /, pending|, ready/ }).first();
  await node.scrollIntoViewIfNeeded();
  const nodeBox = await node.boundingBox();
  if (!nodeBox) throw new Error("the first node is not visible");
  const center = { x: nodeBox.x + nodeBox.width / 2, y: nodeBox.y + nodeBox.height / 2 };
  const beforeNode = await scrollOf();
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 60, center.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Close inspector" })).toHaveCount(0);
  expect((await scrollOf()).left).not.toBe(beforeNode.left);
  await node.click();
  await expect(page.getByRole("button", { name: "Close inspector" })).toBeVisible();

  // Fit view returns to following the canvas width.
  await page.getByRole("button", { name: "Close inspector" }).click();
  await page.getByRole("button", { name: "Fit view" }).click();
  expect(await zoomLabel.textContent()).not.toBe(zoomed);
});
