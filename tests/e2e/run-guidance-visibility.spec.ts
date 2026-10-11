import { expect } from "@playwright/test";
import { executeWithDefaultTools, finishSetup, runProgress, test } from "./support/editor-run.js";

const startRun = async (page: import("@playwright/test").Page, origin: string, task: string) => {
  await finishSetup(page, origin);
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
  await page.getByLabel(/Task description/).fill(task);
  await page.getByRole("button", { name: "Start run" }).click();
};

test.describe("an agent that cannot take guidance", () => {
  test.use({ agentSteering: "unsupported" });

  test("the running step shows no guidance field at all", async ({ page, harness }) => {
    await startRun(page, harness.origin, "No guidance without steering");
    await executeWithDefaultTools(page);
    const running = page.getByRole("button", { name: /Code quality review, running/ });
    await runProgress(running).toBeVisible();
    await running.click();
    // The inspector is open on the running step, and the guidance form is not part of it.
    await expect(page.getByRole("button", { name: "Close inspector" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Step guidance" })).toHaveCount(0);
    await expect(page.getByLabel("Message for selected attempt")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Queue guidance" })).toHaveCount(0);
    harness.releaseReviews();
  });
});

test("a capable agent shows the field only for a step that has an attempt", async ({
  page,
  harness,
}) => {
  await startRun(page, harness.origin, "Guidance needs an attempt");
  // Before anything runs, a pending step has no attempt to address.
  await page
    .getByRole("button", { name: /Requirements and baseline, pending/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Close inspector" })).toBeVisible();
  await expect(page.getByLabel("Message for selected attempt")).toHaveCount(0);
  await page.getByRole("button", { name: "Close inspector" }).click();

  await executeWithDefaultTools(page);
  const running = page.getByRole("button", { name: /Code quality review, running/ });
  await runProgress(running).toBeVisible();
  await running.click();
  await expect(page.getByLabel("Message for selected attempt")).toBeEnabled();
  harness.releaseReviews();
});
