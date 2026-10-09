import { expect } from "@playwright/test";
import { executeWithDefaultTools, finishSetup, runProgress, test } from "./support/editor-run.js";

test("canceling parallel review persists a canceled run after reload", async ({
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
  await page.getByLabel(/Task description/).fill("Cancel during parallel review");
  await page.getByRole("button", { name: "Start run" }).click();
  await executeWithDefaultTools(page);
  await runProgress(
    page.getByRole("button", { name: /Code quality review, running/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel run" }).click();
  await runProgress
    .poll(async () => {
      const response = await page.request.get(`${harness.origin}/api/runs`);
      const body = (await response.json()) as { runs: { status: string }[] };
      return body.runs[0]?.status;
    })
    .toBe("canceled");
  harness.releaseReviews();
  await page.reload();
  await expect(page.getByText("Canceled", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept evidence" })).toHaveCount(0);
});

test("reloading during parallel review reconnects without duplicating attempts", async ({
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
  await page.getByLabel(/Task description/).fill("Reload during parallel review");
  await page.getByRole("button", { name: "Start run" }).click();
  await executeWithDefaultTools(page);
  await runProgress(
    page.getByRole("button", { name: /Code quality review, running/ }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
  harness.releaseReviews();
  await runProgress
    .poll(async () => {
      const response = await page.request.get(`${harness.origin}/api/runs`);
      const body = (await response.json()) as {
        runs: { status: string; steps: { stepId: string; attempts: unknown[] }[] }[];
      };
      const run = body.runs[0];
      return {
        status: run?.status,
        reviewAttempts: run?.steps
          .filter((step) => step.stepId.endsWith("-review"))
          .map((step) => step.attempts.length),
      };
    })
    .toMatchObject({ status: "succeeded", reviewAttempts: [1, 1, 1, 1, 1, 1] });
});

test("streamed message chunks show as one growing activity entry that survives reload", async ({
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
  await page.getByLabel(/Task description/).fill("Stream review commentary");
  await page.getByRole("button", { name: "Start run" }).click();
  await executeWithDefaultTools(page);
  await page.getByRole("button", { name: /Code quality review, running/ }).click();
  const messages = () =>
    page
      .getByLabel("Run inspector")
      .getByRole("list", { name: "Activity events" })
      .getByRole("listitem")
      // Each entry starts with its type label; keep only message entries.
      .filter({ hasText: /^message/ });
  // Two chunks streamed before the review gate render as one entry.
  await expect(messages()).toHaveCount(1);
  await expect(messages()).toContainText("Fixture executing");
  const streaming = await messages().elementHandle();
  harness.releaseReviews();
  // The final chunk arrives live and grows the same entry instead of adding one.
  await expect(messages()).toContainText("Fixture executing quality-review");
  await expect(messages()).toHaveCount(1);
  // Same DOM node as before the final chunk: it grew in place rather than being re-rendered anew.
  expect(
    await streaming?.evaluate(
      (node) => node.isConnected && (node.textContent ?? "").includes("quality-review"),
    ),
  ).toBe(true);
  await runProgress
    .poll(async () => {
      const response = await page.request.get(`${harness.origin}/api/runs`);
      const body = (await response.json()) as { runs: { status: string }[] };
      return body.runs[0]?.status;
    })
    .toBe("succeeded");
  await page.reload();
  await page.getByRole("button", { name: /Code quality review, succeeded/ }).click();
  await expect(messages()).toHaveCount(1);
  await expect(messages()).toContainText("Fixture executing quality-review");
});

test("a blocking agent question survives reload and accepts one answer", async ({
  page,
  harness,
}) => {
  harness.setRequestInput(true);
  await finishSetup(page, harness.origin);
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Use starter template" }).click();
  await page
    .getByLabel("Starter templates")
    .getByRole("button", { name: "Create draft" })
    .first()
    .click();
  await page.getByRole("button", { name: "Publish v1" }).click();
  await page.getByRole("button", { name: "Runs" }).click();
  await page.getByRole("button", { name: /New run/i }).click();
  await page.getByLabel(/Task description/).fill("Answer the implementation question");
  await page.getByRole("button", { name: "Start run" }).click();
  await executeWithDefaultTools(page);

  const prompt = page.getByRole("region", { name: "Agent input request" });
  await expect(prompt.getByRole("heading", { name: "Agent waiting for input" })).toBeVisible();
  await expect(prompt.getByRole("button", { name: "Send answers" })).toBeDisabled();
  await page.reload();
  const restoredPrompt = page.getByRole("region", { name: "Agent input request" });
  await expect(restoredPrompt.getByText("Which approach should this run use?")).toBeVisible();
  await restoredPrompt
    .getByRole("textbox", { name: "Implementation choice" })
    .fill("Keep it small");
  await restoredPrompt.getByRole("button", { name: "Send answers" }).click();
  await runProgress
    .poll(() => harness.inputReplies)
    .toEqual([{ choice: { answers: ["Keep it small"] } }]);
  await runProgress
    .poll(async () => {
      const response = await page.request.get(`${harness.origin}/api/runs`);
      const body = (await response.json()) as { runs: { status: string }[] };
      return body.runs[0]?.status;
    })
    .toBe("succeeded");
  await expect(restoredPrompt).toHaveCount(0);
});
