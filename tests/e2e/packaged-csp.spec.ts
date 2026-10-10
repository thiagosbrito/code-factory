import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { expect, test } from "@playwright/test";
import { startLocalServer } from "../../src/runtime/server.js";

/**
 * The other journeys run on the Vite dev server, which sends none of the runtime's security
 * headers. This one builds the real UI and serves it the way the published package does, so a
 * dependency that needs eval, inline script or a foreign host fails here instead of after release.
 */
let root = "";
let local: Awaited<ReturnType<typeof startLocalServer>> | undefined;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  root = await mkdtemp(join(tmpdir(), "code-factory-csp-"));
  const uiDirectory = join(root, "ui");
  await build({ logLevel: "silent", build: { outDir: uiDirectory, emptyOutDir: true } });
  local = await startLocalServer({
    sessionToken: null,
    projectDirectory: await mkdtemp(join(root, "project-")),
    uiDirectory,
    port: 0,
  });
});

test.afterAll(async () => {
  if (local) {
    local.server.closeAllConnections();
    await new Promise<void>((resolve) => local?.server.close(() => resolve()));
  }
  await rm(root, { recursive: true, force: true });
});

test("the packaged UI runs under its Content-Security-Policy without violations", async ({
  page,
}) => {
  const url = local?.url ?? "";
  const problems: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) =>
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`),
    );
  });
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));

  const response = await page.goto(url);
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  // The demo renders sample runs, Markdown and the run canvas.
  await page.getByRole("button", { name: "Open demo factory" }).click();
  await expect(page.getByRole("heading", { name: "Sample runs" })).toBeVisible();
  await page.getByRole("button", { name: "Exit demo" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Packaged project");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Use starter template" }).click();
  await page
    .getByLabel("Starter templates")
    .getByRole("button", { name: "Create draft" })
    .nth(1)
    .click();
  // The step drawer is a modal dialog, whose scroll lock injects a style element.
  await page.getByRole("button", { name: "Implement or repair", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Step configuration" });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  // The pre-paint theme script is an external file; the policy must allow it and the toggle.
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.getByRole("button", { name: "Runs" }).click();
  await page.getByRole("button", { name: /New run/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  expect(problems).toEqual([]);
});

test("another site cannot frame the packaged UI", async ({ page }) => {
  const url = local?.url ?? "";
  await page.setContent(`<iframe title="hostile" src="${url}" width="800" height="600"></iframe>`);
  const frame = page.frameLocator('iframe[title="hostile"]');
  await page.waitForTimeout(1_000);
  await expect(frame.locator("#root")).toHaveCount(0);
});
