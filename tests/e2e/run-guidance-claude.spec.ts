import { expect } from "@playwright/test";
import { cancelRunAndSettle, runProgress, test } from "./support/editor-run.js";

// The real Claude Code adapter runs against a fake `claude` CLI, so what the browser shows is what
// a Claude Code user gets: a connection that declares steering, and guidance that reaches the step.
test.use({ fakeClaude: true });

test("guidance can be queued for a running Claude Code step", async ({ page, harness }) => {
  await page.goto(harness.origin);
  await page.getByRole("textbox", { name: "Project name" }).fill("Claude project");
  // Choosing the agent connects it after a short pause; no Verify click.
  await page.getByRole("button", { name: /Claude Code.*Executable detected/ }).click();
  await expect(page.getByText(/Claude Code .* · Connected/)).toBeVisible();
  await expect(page.getByText("Guidance", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finish setup" }).click();

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
  await page.getByLabel(/Task description/).fill("Steer a running Claude Code step");
  await page.getByRole("button", { name: "Start run" }).click();

  await harness.holdNextClaudeStep();
  await page.getByRole("button", { name: "Execute run" }).click();
  const grant = page.getByRole("dialog", { name: "Allow Claude Code to run shell commands?" });
  await grant.getByRole("button", { name: "Run without shell" }).click();

  const running = page.getByRole("button", { name: /, running/ }).first();
  await runProgress(running).toBeVisible();
  await running.click();

  // The field and its button are usable for a Claude Code step: nothing is disabled except the
  // button until there is a message to send.
  const message = page.getByLabel("Message for selected attempt");
  await expect(message).toBeEnabled();
  await expect(page.getByRole("button", { name: "Queue guidance" })).toBeDisabled();
  await message.fill("Check the accessible name before finishing.");
  const queue = page.getByRole("button", { name: "Queue guidance" });
  await expect(queue).toBeEnabled();
  await queue.click();

  const history = page.getByRole("list", { name: "Guidance history" });
  await expect(history).toContainText("Check the accessible name before finishing.");
  await runProgress(history).toContainText(/delivered|acknowledged/i);
  // The running step received the guidance and answered it.
  await runProgress(
    page.getByText(/Guidance received: Check the accessible name/).first(),
  ).toBeVisible();
  await cancelRunAndSettle(page, harness.origin);
});
