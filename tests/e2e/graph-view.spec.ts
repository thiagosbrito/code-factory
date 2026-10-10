import { expect } from "@playwright/test";
import { test } from "./support/editor-run.js";
import {
  connect,
  dependency,
  dragStepTo,
  insideLane,
  laneBox,
  openStarterInGraph,
  selectDependency,
  stepNode,
  zoomOf,
} from "./support/graph.js";

// A tall, wide window keeps the whole canvas on screen at a readable zoom for real pointer drags.
test.use({ viewport: { width: 1600, height: 1200 } });

const cycleMessage = "Dependency cycles are not allowed; repairs require explicit bounded policy.";

test("opening the Graph view draws the starter's lanes and dependencies without changing the draft", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  for (const lane of ["1. Evidence", "2. Plan", "3. Implementation", "4. Review", "5. Validate"])
    await expect(page.getByRole("heading", { name: lane })).toBeVisible();
  await expect(dependency(page, "Implement", "Review")).toHaveCount(1);
  await expect(dependency(page, "Review", "Validate")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
});

test("dragging near an input handle snaps a new dependency that Undo removes", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  await expect(dependency(page, "Implement", "Validate")).toHaveCount(0);
  // About 28 canvas px from the target handle: outside the default 20 px radius, inside ours.
  const zoom = await zoomOf(page);
  await connect(page, "Implement", "Validate", { x: -20 * zoom, y: 20 * zoom });
  await expect(dependency(page, "Implement", "Validate")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(dependency(page, "Implement", "Validate")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
});

test("releasing far from every input handle connects nothing", async ({ page, harness }) => {
  await openStarterInGraph(page, harness.origin);
  const zoom = await zoomOf(page);
  await connect(page, "Implement", "Validate", { x: -45 * zoom, y: 45 * zoom });
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("a connection that would close a cycle shows the domain message and draws no edge", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  await connect(page, "Validate", "Implement");
  await expect(page.getByRole("alert").filter({ hasText: cycleMessage })).toBeVisible();
  await expect(dependency(page, "Validate", "Implement")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
});

test("deleting a selected connection with the keyboard or its control is undoable", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  await selectDependency(page, "Implement", "Review");
  await page.keyboard.press("Delete");
  await expect(dependency(page, "Implement", "Review")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(dependency(page, "Implement", "Review")).toHaveCount(1);

  await selectDependency(page, "Review", "Validate");
  await page.getByRole("button", { name: "Delete: Dependency from Review to Validate" }).click();
  await expect(dependency(page, "Review", "Validate")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
});

test("dropping a step in another lane changes its stage, persists after Save and reload", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  const plan = await laneBox(page, "2. Plan");
  await dragStepTo(page, "Implement", { x: plan.x + plan.width / 2, y: plan.y + 300 });
  await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
  const moved = await stepNode(page, "Implement").boundingBox();
  const lane = await laneBox(page, "2. Plan");
  expect(moved).not.toBeNull();
  expect(moved?.x ?? 0).toBeGreaterThanOrEqual(lane.x - 1);
  expect((moved?.x ?? 0) + (moved?.width ?? 0)).toBeLessThanOrEqual(lane.x + lane.width + 1);
  // The whole drag is one undo entry, and the connection is untouched.
  await expect(dependency(page, "Implement", "Review")).toHaveCount(1);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved to the project.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Edit draft" }).first().click();
  await expect(stepNode(page, "Implement")).toBeVisible();
  const reloaded = await stepNode(page, "Implement").boundingBox();
  const reloadedLane = await laneBox(page, "2. Plan");
  expect(reloaded?.x ?? 0).toBeGreaterThanOrEqual(reloadedLane.x - 1);
  expect((reloaded?.x ?? 0) + (reloaded?.width ?? 0)).toBeLessThanOrEqual(
    reloadedLane.x + reloadedLane.width + 1,
  );
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("one drag across lanes is a single undo entry", async ({ page, harness }) => {
  await openStarterInGraph(page, harness.origin);
  const before = await stepNode(page, "Implement").boundingBox();
  const plan = await laneBox(page, "2. Plan");
  await dragStepTo(page, "Implement", { x: plan.x + plan.width / 2, y: plan.y + 300 });
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  // A drag is not a click: the step drawer must stay closed.
  await expect(page.getByRole("dialog", { name: "Step configuration" })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
  const after = await stepNode(page, "Implement").boundingBox();
  expect(Math.round(after?.x ?? 0)).toBe(Math.round(before?.x ?? 1));
  expect(Math.round(after?.y ?? 0)).toBe(Math.round(before?.y ?? 1));
});

test("a refused lane drop explains why and snaps the step back", async ({ page, harness }) => {
  // The staged starter's gate steps belong to a group, so they may not change lane.
  await openStarterInGraph(page, harness.origin, 1);
  const before = await insideLane(page, "Lint changed files", "5. Validate");
  const evidence = await laneBox(page, "1. Evidence");
  await dragStepTo(page, "Lint changed files", {
    x: evidence.x + evidence.width / 2,
    y: evidence.y + 200,
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "belongs to a group, join, or decision" }),
  ).toBeVisible();
  // The alert shifts the page, so compare the position inside the lane, not on screen.
  expect(await insideLane(page, "Lint changed files", "5. Validate")).toEqual(before);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("clicking a step opens the step drawer", async ({ page, harness }) => {
  await openStarterInGraph(page, harness.origin);
  await stepNode(page, "Review").click();
  const drawer = page.getByRole("dialog", { name: "Step configuration" });
  await expect(drawer.getByRole("textbox", { name: "Title" })).toHaveValue("Review");
});

test("the Graph view follows the theme toggle", async ({ page, harness }) => {
  await openStarterInGraph(page, harness.origin);
  const flow = page.locator(".react-flow");
  const light = await flow.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(flow).toHaveClass(/dark/);
  expect(await flow.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
    light,
  );
});
