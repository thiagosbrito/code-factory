import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createViteServer } from "vite";
import { expect, test as base } from "@playwright/test";
import type { AgentConnection } from "../../src/adapters/contract.js";
import { ConnectionRegistry } from "../../src/runtime/connections.js";
import { startLocalServer } from "../../src/runtime/server.js";

type Harness = { origin: string };

const detectedCodex: AgentConnection = {
  provider: "codex",
  executable: "/fixture/codex",
  installation: "detected",
  authentication: "unknown",
  capabilities: { streaming: "unknown", steering: "unknown", resume: "unknown" },
};

const test = base.extend<{ harness: Harness }>({
  harness: async ({ browserName: _browserName }, use) => {
    const projectDirectory = await mkdtemp(join(tmpdir(), "code-factory-e2e-"));
    const registry = new ConnectionRegistry(
      projectDirectory,
      async () => [
        detectedCodex,
        {
          provider: "kiro",
          executable: "/fixture/kiro",
          installation: "detected",
          authentication: "unknown",
          capabilities: { streaming: "unknown", steering: "unknown", resume: "unknown" },
        },
      ],
      async (executable) => ({
        close() {},
        async inspect(): Promise<AgentConnection> {
          return {
            ...detectedCodex,
            executable,
            identity: "Codex CLI",
            version: "0.1.0-fixture",
            protocol: "Codex app-server JSON-RPC over stdio",
            authentication: "authenticated",
            capabilities: { streaming: "supported", steering: "supported", resume: "supported" },
            models: [
              { id: "model-a", displayName: "Model A", efforts: ["low", "high"] },
              { id: "model-b", displayName: "Model B", efforts: [] },
            ],
          };
        },
      }),
    );
    let ui: Awaited<ReturnType<typeof createViteServer>> | undefined;
    const runtime = await startLocalServer({
      projectDirectory,
      port: 0,
      connections: registry,
      get devOrigin() {
        return ui?.resolvedUrls?.local[0]?.replace(/\/$/, "") ?? "http://127.0.0.1:4311";
      },
    });
    try {
      ui = await createViteServer({
        server: { host: "127.0.0.1", port: 0, strictPort: false, proxy: { "/api": runtime.url } },
      });
      await ui.listen();
      const origin = ui.resolvedUrls?.local[0]?.replace(/\/$/, "");
      if (!origin) throw new Error("Vite did not expose a local URL");
      await use({ origin });
    } finally {
      await ui?.close();
      registry.close();
      await new Promise<void>((resolve, reject) =>
        runtime.server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(projectDirectory, { recursive: true, force: true });
    }
  },
});

test("verified model selection, loop controls, and run intake work as one keyboard-safe journey", async ({
  page,
  harness,
}) => {
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
  await page.getByRole("combobox", { name: "Effort" }).selectOption("high");
  await page.getByRole("button", { name: "Finish setup" }).click();

  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Use starter template" }).click();
  const templates = page.getByLabel("Starter templates");
  await templates.getByRole("button", { name: "Create draft" }).first().click();

  const firstStep = page.getByRole("button", { name: /Implement|Build/ }).first();
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
  await page.getByLabel(/Task description/).fill("Implement and review the requested change");
  await expect(page.getByRole("button", { name: "Start run" })).toBeEnabled();
});

test("select controls remain usable at mobile width and with reduced motion", async ({
  page,
  harness,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(harness.origin);
  await page.getByRole("textbox", { name: "Project name" }).fill("Mobile project");
  await page.getByRole("button", { name: /Codex.*Executable detected/ }).click();
  await page.getByRole("button", { name: "Verify connection" }).click();
  const model = page.getByRole("combobox", { name: "Project default model" });
  await model.scrollIntoViewIfNeeded();
  await expect(model).toBeInViewport();
  await model.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(model).toBeFocused();
});
