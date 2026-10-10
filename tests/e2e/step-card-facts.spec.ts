import { expect } from "@playwright/test";
import { test } from "./support/editor-run.js";
import { openStarterInGraph, stepNode } from "./support/graph.js";

test.use({ viewport: { width: 1600, height: 1200 } });

test("the Graph card and the Board card both state agent, model and effort", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  const graphCard = stepNode(page, "Implement");
  for (const label of ["Agent:", "Model:", "Effort:"]) await expect(graphCard).toContainText(label);
  // Nothing is clipped: every fact line sits inside the card.
  const box = await graphCard.boundingBox();
  const effort = await graphCard.getByText("Effort:").boundingBox();
  expect((effort?.y ?? 0) + (effort?.height ?? 0)).toBeLessThanOrEqual(
    (box?.y ?? 0) + (box?.height ?? 0),
  );
  const graphFacts = await graphCard.locator("dd").allTextContents();

  await page.getByRole("button", { name: "Board" }).click();
  const boardCard = page
    .getByRole("button", { name: "Implement", exact: true })
    .locator("xpath=ancestor::div[contains(@class,'shadow-sm')][1]");
  for (const label of ["Agent:", "Model:", "Effort:"]) await expect(boardCard).toContainText(label);
  expect(await boardCard.locator("dd").allTextContents()).toEqual(graphFacts);
});
