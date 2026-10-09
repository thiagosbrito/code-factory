import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { finishSetup, test } from "./support/editor-run.js";

test("a loop draft survives reload and canonical JSON can be exported and imported", async ({
  page,
  harness,
}) => {
  await finishSetup(page, harness.origin);
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Create empty loop" }).first().click();
  const title = page.getByRole("textbox", { name: "Loop title" });
  await title.fill("Portable review loop");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(title).toHaveValue("Untitled loop");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(title).toHaveValue("Portable review loop");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "← Loops" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Loops" }).click();
  await expect(page.getByRole("heading", { name: "Portable review loop" })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Browser did not save the exported loop");
  const exported = await readFile(path, "utf8");
  expect(JSON.parse(exported)).toMatchObject({
    format: "code-factory-loop",
    definition: { name: "Portable review loop" },
  });

  await page.getByRole("button", { name: "Import JSON" }).click();
  await page.getByLabel("Paste a portable loop document").fill("{invalid");
  await page.getByRole("button", { name: "Validate import" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Paste a portable loop document").fill(exported);
  await page.getByRole("button", { name: "Validate import" }).click();
  await expect(page.getByText(/Valid draft with/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm import: Portable review loop" }).click();
  await expect(page.getByRole("textbox", { name: "Loop title" })).toHaveValue(
    "Portable review loop",
  );
  const response = await page.request.get(`${harness.origin}/api/loops`);
  const body = (await response.json()) as { loops: { id: string }[] };
  expect(body.loops).toHaveLength(2);
});

test("native configuration export requires preview and writes only after apply", async ({
  page,
  harness,
}) => {
  await finishSetup(page, harness.origin);
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Create empty loop" }).first().click();
  await page.getByRole("button", { name: "+ Agent step" }).click();
  const translation = page.getByRole("region", { name: "Native configuration translation" });
  await translation.getByRole("combobox", { name: "Translation direction" }).selectOption("export");
  await translation.getByRole("combobox", { name: "Configuration name" }).fill("browser-rule");
  await translation.getByRole("button", { name: "Preview" }).click();
  await expect(translation.getByText(/Affected path:/)).toBeVisible();
  await expect(translation.getByRole("button", { name: "Apply export" })).toBeEnabled();
  const relativePath = await translation.locator("code").first().textContent();
  if (!relativePath) throw new Error("Preview did not provide an export path");
  await expect(access(join(harness.projectDirectory, relativePath))).rejects.toThrow();
  await translation.getByRole("button", { name: "Apply export" }).click();
  await expect(translation.getByRole("status")).toContainText(`Exported ${relativePath}.`);
  const content = await readFile(join(harness.projectDirectory, relativePath), "utf8");
  expect(content).toContain("Describe this step.");
  await page.getByRole("button", { name: "← Loops" }).click();
  await page.getByRole("button", { name: "Create empty loop" }).first().click();
  const emptyTranslation = page.getByRole("region", { name: "Native configuration translation" });
  await emptyTranslation.getByRole("combobox", { name: "Configuration name" }).fill("browser-rule");
  await emptyTranslation.getByRole("button", { name: "Preview" }).click();
  await expect(emptyTranslation.getByText(/Imported draft step:/)).toContainText("New agent step");
  await emptyTranslation.getByRole("button", { name: "Apply import" }).click();
  await expect(emptyTranslation.getByRole("status")).toContainText("Imported into the draft");
});
