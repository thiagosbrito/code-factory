import { expect, type Page } from "@playwright/test";
import { test } from "./support/editor-run.js";
import {
  dependency,
  dragStepTo,
  insideLane,
  laneBox,
  openStarterInGraph,
  stepNode,
} from "./support/graph.js";

test.use({ viewport: { width: 1600, height: 1200 } });

const undo = (page: Page) => page.getByRole("button", { name: "Undo" });
const save = (page: Page) => page.getByRole("button", { name: "Save draft" });

const dropInto = async (page: Page, step: string, lane: string) => {
  const box = await laneBox(page, lane);
  await dragStepTo(page, step, { x: box.x + box.width / 2, y: box.y + 320 });
};

const reopenDraft = async (page: Page) => {
  await save(page).click();
  await expect(page.getByText("Draft saved to the project.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Edit draft" }).first().click();
  await page.getByRole("button", { name: "Graph" }).click();
};

const laneOf = async (page: Page, step: string, lane: string) => {
  const node = await stepNode(page, step).boundingBox();
  const box = await laneBox(page, lane);
  return (
    !!node &&
    node.x >= box.x - 1 &&
    node.x + node.width <= box.x + box.width + 1 &&
    node.y >= box.y &&
    node.y + node.height <= box.y + box.height + 1
  );
};

test("moving a plain step to another lane keeps its dependencies, is one undo entry and persists", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  await dropInto(page, "Implement", "2. Plan");
  expect(await laneOf(page, "Implement", "2. Plan")).toBe(true);
  await expect(dependency(page, "Implement", "Review")).toHaveCount(1);
  await expect(save(page)).toBeEnabled();
  await undo(page).click();
  expect(await laneOf(page, "Implement", "3. Implementation")).toBe(true);
  await expect(undo(page)).toBeDisabled();
  await page.getByRole("button", { name: "Redo" }).click();

  await reopenDraft(page);
  expect(await laneOf(page, "Implement", "2. Plan")).toBe(true);
  await expect(dependency(page, "Implement", "Review")).toHaveCount(1);
});

test("moving a step into Review asks first: Cancel snaps it back, Apply moves it", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  const before = await insideLane(page, "Implement", "3. Implementation");
  await dropInto(page, "Implement", "4. Review");
  const dialog = page.getByRole("dialog", { name: "Apply this change?" });
  await expect(dialog).toContainText("Review lane makes it a review step");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await insideLane(page, "Implement", "3. Implementation")).toEqual(before);
  await expect(undo(page)).toBeDisabled();

  await dropInto(page, "Implement", "4. Review");
  await dialog.getByRole("button", { name: "Apply change" }).click();
  expect(await laneOf(page, "Implement", "4. Review")).toBe(true);
  await undo(page).click();
  await expect(undo(page)).toBeDisabled();
  expect(await laneOf(page, "Implement", "3. Implementation")).toBe(true);
});

test("a group member refuses a lane move, snaps back and shows the reason on screen", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin, 1);
  const before = await insideLane(page, "Lint changed files", "5. Validate");
  await dropInto(page, "Lint changed files", "1. Evidence");
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "belongs to a group, join, or decision" });
  await expect(alert).toBeVisible();
  await expect(alert).toBeInViewport();
  expect(await insideLane(page, "Lint changed files", "5. Validate")).toEqual(before);
  await expect(undo(page)).toBeDisabled();
});

test("a check step cannot leave Validate", async ({ page, harness }) => {
  await openStarterInGraph(page, harness.origin);
  // The starter's Validate step is an agent step; the Validate lane's own add makes a real check.
  await page.getByRole("button", { name: "Add step to 5. Validate" }).click();
  await expect(stepNode(page, "New check")).toBeVisible();
  expect(await laneOf(page, "New check", "5. Validate")).toBe(true);
  const before = await insideLane(page, "New check", "5. Validate");
  await dropInto(page, "New check", "2. Plan");
  const alert = page.getByRole("alert").filter({ hasText: "Check steps belong in Validate." });
  await expect(alert).toBeVisible();
  await expect(alert).toBeInViewport();
  expect(await insideLane(page, "New check", "5. Validate")).toEqual(before);
  // Only the add is in history; the refused move recorded nothing.
  await undo(page).click();
  await expect(undo(page)).toBeDisabled();
  await expect(stepNode(page, "New check")).toHaveCount(0);
});

test("adding a step from a lane header puts it in that lane as one undo entry and persists", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  const cards = page.getByRole("group", { name: /^New agent step, / });
  await expect(cards).toHaveCount(0);
  await page.getByRole("button", { name: "Add step to 2. Plan" }).click();
  await expect(cards).toHaveCount(1);
  expect(await laneOf(page, "New agent step", "2. Plan")).toBe(true);
  await undo(page).click();
  await expect(cards).toHaveCount(0);
  await expect(undo(page)).toBeDisabled();
  await page.getByRole("button", { name: "Redo" }).click();

  await reopenDraft(page);
  await expect(cards).toHaveCount(1);
  expect(await laneOf(page, "New agent step", "2. Plan")).toBe(true);
});

test("adding to a lane after positions are stored lands in the lane without overlapping", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  // Dropping a step stores positions for every step; the add then takes the stored-position path.
  await dropInto(page, "Implement", "2. Plan");
  await page.getByRole("button", { name: "Add step to 2. Plan" }).click();
  const added = stepNode(page, "New agent step");
  await expect(added).toBeVisible();
  expect(await laneOf(page, "New agent step", "2. Plan")).toBe(true);
  const [a, b] = await Promise.all([
    added.boundingBox(),
    stepNode(page, "Implement").boundingBox(),
  ]);
  const apart = !a || !b || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1;
  expect(apart).toBe(true);
  await page.getByRole("status", { name: "Graph announcements" }).waitFor({ state: "attached" });
  await expect(page.getByRole("status", { name: "Graph announcements" })).toHaveText(
    /Added a step to 2\. Plan/,
  );

  await reopenDraft(page);
  expect(await laneOf(page, "New agent step", "2. Plan")).toBe(true);
});

test("moving an agent step into Validate asks first, because it then receives every upstream result", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  const before = await insideLane(page, "Implement", "3. Implementation");
  await dropInto(page, "Implement", "5. Validate");
  const dialog = page.getByRole("dialog", { name: "Apply this change?" });
  await expect(dialog).toContainText("into the Validate lane");
  await expect(dialog).toContainText("results of every upstream step");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await insideLane(page, "Implement", "3. Implementation")).toEqual(before);
  await expect(undo(page)).toBeDisabled();
});
