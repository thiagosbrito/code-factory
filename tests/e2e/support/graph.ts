import { expect, type Locator, type Page } from "@playwright/test";
import { finishSetup } from "./editor-run.js";

/** Creates a starter draft (0 = three-step, 1 = staged) and opens it in the Graph view. */
export const openStarterInGraph = async (page: Page, origin: string, starter: 0 | 1 = 0) => {
  await finishSetup(page, origin);
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Use starter template" }).click();
  await page
    .getByLabel("Starter templates")
    .getByRole("button", { name: "Create draft" })
    .nth(starter)
    .click();
  await page.getByRole("button", { name: "Graph" }).click();
  await expect(page.getByRole("region", { name: "Graph view" })).toBeVisible();
  await expect(page.locator(".react-flow__node-step").first()).toBeVisible();
};

export const stepNode = (page: Page, name: string): Locator =>
  page.getByRole("group", { name: new RegExp(`^${name}, `) });

export const dependency = (page: Page, from: string, to: string): Locator =>
  page.locator(`.react-flow__edge[aria-label="Dependency from ${from} to ${to}"]`);

const centre = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element has no layout");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** A real pointer drag between two points, in steps so the library sees movement. */
export const dragBetween = async (
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
};

/** Drags from a step's output handle to near (offset px from) another step's input handle. */
export const connect = async (
  page: Page,
  from: string,
  to: string,
  offset: { x: number; y: number } = { x: 0, y: 0 },
) => {
  const source = await centre(stepNode(page, from).locator(".react-flow__handle.source"));
  const target = await centre(stepNode(page, to).locator(".react-flow__handle.target"));
  await dragBetween(page, source, { x: target.x + offset.x, y: target.y + offset.y });
};

/** Drags a step by its body (not a handle) to a point. */
export const dragStepTo = async (page: Page, name: string, target: { x: number; y: number }) => {
  const node = stepNode(page, name);
  const box = await node.boundingBox();
  if (!box) throw new Error("Node has no layout");
  await dragBetween(page, { x: box.x + box.width / 2, y: box.y + box.height - 8 }, target);
};

export const laneBox = async (page: Page, title: string) => {
  const box = await page
    .getByRole("heading", { name: title })
    .locator("xpath=ancestor::*[contains(@class,'react-flow__node')][1]")
    .boundingBox();
  if (!box) throw new Error(`Lane ${title} has no layout`);
  return box;
};

/** The canvas zoom, so pixel distances on screen can be stated in canvas units. */
export const zoomOf = (page: Page): Promise<number> =>
  page.locator(".react-flow__viewport").evaluate((viewport) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    return matrix.a;
  });

/** Clicks the middle of a drawn connection with the real pointer, which selects it. */
export const selectDependency = async (page: Page, from: string, to: string) => {
  const box = await dependency(page, from, to).locator(".react-flow__edge-path").boundingBox();
  if (!box) throw new Error("Edge has no layout");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

/** A node's position relative to its lane, which does not change when the page layout shifts. */
export const insideLane = async (page: Page, name: string, lane: string) => {
  const node = await stepNode(page, name).boundingBox();
  const box = await laneBox(page, lane);
  if (!node) throw new Error("Node has no layout");
  return { x: Math.round(node.x - box.x), y: Math.round(node.y - box.y) };
};
