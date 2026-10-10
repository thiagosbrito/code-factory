import { expect } from "@playwright/test";
import { executeWithDefaultTools, runProgress, test } from "./support/editor-run.js";

test("verified model selection, loop controls, and run intake work as one keyboard-safe journey", async ({
  page,
  harness,
}) => {
  // This journey starts untrusted, as a freshly cloned project would.
  await page.request.delete(`${harness.origin}/api/project/trust`);
  await page.goto(harness.origin);
  await page.getByRole("textbox", { name: "Project name" }).fill("Browser project");

  await page.getByRole("button", { name: /Kiro.*Executable detected/ }).click();
  await expect(page.getByRole("combobox", { name: "Project default model" })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("unavailable");

  const codex = page.getByRole("button", { name: /Codex.*Executable detected/ });
  await codex.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Verify connection" }).click();
  const model = page.getByRole("combobox", { name: "Project default model" });
  await expect(model).toBeEnabled();
  await model.selectOption("model-a");
  await page.getByRole("slider", { name: "Project default effort" }).fill("2");
  await page.getByRole("button", { name: "Finish setup" }).click();

  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Use starter template" }).click();
  const templates = page.getByLabel("Starter templates");
  await templates.getByRole("button", { name: "Create draft" }).nth(1).click();

  const firstStep = page.getByRole("button", { name: "Implement or repair", exact: true });
  await firstStep.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Step configuration" });
  await expect(drawer.getByRole("textbox", { name: "Title" })).toBeFocused();
  await expect(drawer.getByRole("combobox", { name: "Step coding agent" })).toBeVisible();
  await expect(drawer.getByRole("combobox", { name: "Join mode" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(firstStep).toBeFocused();

  await page.getByRole("button", { name: "Publish v1" }).click();
  await page.getByRole("button", { name: "Runs" }).click();
  await page.getByRole("button", { name: /New run/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel(/Ticket number/).fill("THI-27");
  await page.getByRole("button", { name: "Retrieve" }).click();
  await expect(page.getByText("Complete browser acceptance")).toBeVisible();
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.getByRole("heading", { name: "Complete browser acceptance" })).toBeVisible();
  await executeWithDefaultTools(page, { trustFirst: true });

  await runProgress(
    page.getByRole("button", { name: /Code quality review, running/ }),
  ).toBeVisible();
  await runProgress(
    page.getByRole("button", { name: /React and accessibility review, running/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Code quality review, running/ }).click();
  const guidance = page.getByLabel("Message for selected attempt");
  await guidance.fill("Check the accessible name before completing review.");
  await page.getByRole("button", { name: "Queue guidance" }).click();
  await runProgress
    .poll(() =>
      harness.steered.some((message) =>
        message.startsWith("Check the accessible name before completing review."),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Close inspector" }).click();

  harness.releaseReviews();
  await runProgress
    .poll(async () => {
      const response = await page.request.get(`${harness.origin}/api/runs`);
      const body = (await response.json()) as {
        runs: { status: string; steps: { stepId: string; status: string; outcome?: string }[] }[];
      };
      return JSON.stringify({ runStatus: body.runs[0]?.status, steps: body.runs[0]?.steps });
    })
    .toContain('"runStatus":"succeeded"');
  await runProgress
    .poll(async () => {
      const runs = (await (await page.request.get(`${harness.origin}/api/runs`)).json()) as {
        runs: { snapshot: { id: string } }[];
      };
      const response = await page.request.get(
        `${harness.origin}/api/runs/${runs.runs[0]?.snapshot.id}/evidence`,
      );
      return JSON.stringify(await response.json());
    })
    .toContain('"validation":"passed"');
  await expect(page.getByText(/Local validation:/)).toContainText("Passed");
  await runProgress(
    page.getByRole("button", { name: /Code quality review, succeeded/ }),
  ).toBeVisible();
  // Changed files open from the evidence dialog, which hands off to the run inspector.
  await page.getByRole("button", { name: "Final evidence summary" }).click();
  await page
    .getByRole("dialog", { name: "Final evidence summary" })
    .getByRole("button", { name: /Changed files/ })
    .click();
  await expect(page.getByRole("button", { name: /fixture-output\.txt added/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Selected diff" })).toContainText(
    "+fixture change",
  );
  await page.getByRole("button", { name: "Close inspector" }).click();
  await page.getByRole("button", { name: "Accept evidence" }).click();
  await expect(page.getByText(/Human acceptance:/)).toContainText("accepted");
});

test("a failed review can be retried from its selected latest attempt", async ({
  page,
  harness,
}) => {
  harness.setFailFirstReview(true);
  await page.goto(harness.origin);
  await page.getByRole("textbox", { name: "Project name" }).fill("Retry project");
  await page.getByRole("button", { name: /Codex.*Executable detected/ }).click();
  await page.getByRole("button", { name: "Verify connection" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();

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
  await page.getByLabel(/Task description/).fill("Exercise selected retry");
  await page.getByRole("button", { name: "Start run" }).click();
  await executeWithDefaultTools(page);

  const failedReview = page.getByRole("button", { name: /Review, failed, 1 attempts/ });
  await expect(failedReview).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept evidence" })).toHaveCount(0);
  await failedReview.click();
  await page.getByRole("button", { name: "Retry…" }).click();
  await page.getByRole("button", { name: "Start Attempt 2" }).click();
  await expect(page.getByRole("button", { name: /Review, succeeded, 2 attempts/ })).toBeVisible();
  await runProgress
    .poll(async () => {
      const response = await page.request.get(`${harness.origin}/api/runs`);
      const body = (await response.json()) as { runs: { status: string }[] };
      return body.runs[0]?.status;
    })
    .toBe("succeeded");
  await page.getByRole("button", { name: "Accept evidence" }).click();
  await expect(page.getByText(/Human acceptance:/)).toContainText("accepted");
  await page.reload();
  await page.getByRole("button", { name: "← All runs" }).click();
  await page.getByRole("button", { name: /Exercise selected retry/ }).click();
  await expect(page.getByText(/Human acceptance:/)).toContainText("accepted");
});
