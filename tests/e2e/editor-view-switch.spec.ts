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
