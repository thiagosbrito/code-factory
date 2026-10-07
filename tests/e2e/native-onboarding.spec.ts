import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createViteServer } from "vite";
import { expect, test } from "@playwright/test";
import { startLocalServer } from "../../src/runtime/server.js";

test.skip(process.env.CODE_FACTORY_E2E_NATIVE !== "1", "Run with pnpm test:e2e:native");

test("native Codex verifies, exposes its catalog, and persists a selected model @native", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const projectDirectory = await mkdtemp(join(tmpdir(), "code-factory-native-onboarding-"));
  let ui: Awaited<ReturnType<typeof createViteServer>> | undefined;
  const runtime = await startLocalServer({
    projectDirectory,
    port: 0,
    get devOrigin() {
      return ui?.resolvedUrls?.local[0]?.replace(/\/$/, "") ?? "http://127.0.0.1:4311";
    },
  });
  try {
    ui = await createViteServer({
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
        proxy: { "/api": runtime.url },
        watch: { ignored: ["**/test-results/**", "**/playwright-report/**"] },
      },
    });
    await ui.listen();
    const origin = ui.resolvedUrls?.local[0];
    if (!origin) throw new Error("Vite did not expose a local URL");
    await page.goto(origin);
    await page.getByRole("textbox", { name: "Project name" }).fill("Native connection check");
    await page.getByRole("button", { name: /Codex.*Executable detected/ }).click();
    await page.getByRole("button", { name: "Verify connection" }).click();
    await expect(page.getByRole("combobox", { name: "Project default model" })).toBeEnabled({
      timeout: 45_000,
    });
    const models = page.getByRole("combobox", { name: "Project default model" }).locator("option");
    expect(await models.count()).toBeGreaterThan(1);
    const selectedModel = await models.nth(1).getAttribute("value");
    if (!selectedModel) throw new Error("Native catalog returned an empty model identifier");
    await page.getByRole("combobox", { name: "Project default model" }).selectOption(selectedModel);
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page.getByRole("heading", { name: "No runs yet" })).toBeVisible();
    const saved = JSON.parse(
      await readFile(join(projectDirectory, ".code-factory", "project.json"), "utf8"),
    ) as { defaultBinding: { provider: string; model: string } };
    expect(saved.defaultBinding).toMatchObject({ provider: "codex", model: selectedModel });
  } finally {
    await ui?.close();
    await new Promise<void>((resolve, reject) =>
      runtime.server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(projectDirectory, { recursive: true, force: true });
  }
});
