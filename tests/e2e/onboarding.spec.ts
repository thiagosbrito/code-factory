import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createViteServer } from "vite";
import { expect, test as base } from "@playwright/test";
import { CLAUDE_CODE_MODELS } from "../../src/adapters/claude-code.js";
import type { AgentConnection } from "../../src/adapters/contract.js";
import { ConnectionRegistry } from "../../src/runtime/connections.js";
import { startLocalServer } from "../../src/runtime/server.js";

const candidate = (provider: AgentConnection["provider"], detected = false): AgentConnection => ({
  provider,
  executable: detected ? `/fixture/${provider}` : null,
  installation: detected ? "detected" : "missing",
  authentication: "unknown",
  capabilities: {
    streaming: "unknown",
    steering: "unknown",
    resume: "unknown",
    pause: "unknown",
    waitingInput: "unknown",
  },
});

type Inspection = "authenticated" | "unauthenticated" | "error";
type Harness = {
  origin: string;
  projectDirectory: string;
  connections: string[];
  setInspection: (value: Inspection) => void;
  setModels: (models: NonNullable<AgentConnection["models"]>) => void;
  setCandidates: (agents: AgentConnection[]) => void;
  config: () => Promise<Record<string, unknown> | null>;
};

const test = base.extend<{ harness: Harness }>({
  harness: async ({ browserName: _browserName }, use) => {
    const projectDirectory = await mkdtemp(join(tmpdir(), "code-factory-onboarding-"));
    const connections: string[] = [];
    let inspection: Inspection = "authenticated";
    let models: NonNullable<AgentConnection["models"]> = [
      { id: "model-a", displayName: "Model A", efforts: ["low", "high"] },
      { id: "model-b", displayName: "Model B", efforts: [] },
    ];
    let candidates = [
      candidate("codex", true),
      candidate("cursor", true),
      candidate("kiro", true),
      candidate("claude-code", false),
      candidate("custom"),
    ];
    const registry = new ConnectionRegistry(
      projectDirectory,
      async () => candidates,
      async (executable) => {
        connections.push(executable);
        if (inspection === "error") throw new Error("Handshake failed");
        return {
          close() {},
          async inspect(): Promise<AgentConnection> {
            return {
              ...candidate("codex", true),
              executable,
              identity: "Codex CLI",
              version: "0.160.0",
              protocol: "Codex app-server JSON-RPC over stdio",
              authentication:
                inspection === "unauthenticated" ? "unauthenticated" : "authenticated",
              models,
              capabilities: {
                streaming: "supported",
                steering: "supported",
                resume: "supported",
                pause: "unsupported",
                waitingInput: "unsupported",
              },
            };
          },
        };
      },
      async (executable) => ({
        close() {},
        async inspect(): Promise<AgentConnection> {
          return {
            ...candidate("kiro", true),
            executable,
            identity: "Kiro CLI",
            version: "2.0-fixture",
            protocol: "Kiro v2 stream JSON",
            authentication: "authenticated",
            models: [
              { id: "kiro-auto", displayName: "Auto", efforts: [] },
              { id: "kiro-fast", displayName: "Fast", efforts: [] },
            ],
            capabilities: {
              streaming: "supported",
              steering: "unsupported",
              resume: "unsupported",
              pause: "unsupported",
              waitingInput: "unsupported",
            },
          };
        },
      }),
      async (executable) => ({
        close() {},
        async inspect(): Promise<AgentConnection> {
          return {
            ...candidate("claude-code", true),
            executable,
            identity: "Claude Code",
            version: "2.1.295",
            protocol: "claude-code-stream-json",
            authentication: "authenticated",
            models: CLAUDE_CODE_MODELS,
            capabilities: {
              streaming: "supported",
              steering: "unsupported",
              resume: "unsupported",
              pause: "unsupported",
              waitingInput: "unsupported",
            },
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
        server: {
          host: "127.0.0.1",
          port: 0,
          strictPort: false,
          proxy: { "/api": runtime.url },
          watch: { ignored: ["**/test-results/**", "**/playwright-report/**"] },
        },
      });
      await ui.listen();
      const origin = ui.resolvedUrls?.local[0]?.replace(/\/$/, "");
      if (!origin) throw new Error("Vite did not expose a local URL");
      await use({
        origin,
        projectDirectory,
        connections,
        setInspection: (value) => (inspection = value),
        setModels: (value) => (models = value),
        setCandidates: (value) => (candidates = value),
        config: async () => {
          try {
            return JSON.parse(
              await readFile(join(projectDirectory, ".code-factory", "project.json"), "utf8"),
            ) as Record<string, unknown>;
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
            throw error;
          }
        },
      });
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

test("fresh setup is blank, uses the trusted path, and saves without an agent", async ({
  page,
  harness,
}) => {
  await page.goto(harness.origin);
  await expect(page.getByRole("heading", { name: "Connect your first project" })).toBeVisible();
  await expect(page.getByLabel("Canonical project path")).toContainText(harness.projectDirectory);
  await expect(page.getByRole("textbox", { name: "Project name" })).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Project default model" })).toBeDisabled();
  await expect.poll(() => harness.config()).toBeNull();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("alert")).toContainText("Enter a project name");
  await expect(page.getByRole("textbox", { name: "Project name" })).toBeFocused();
  await page.getByRole("textbox", { name: "Project name" }).fill("  New project  ");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("heading", { name: "No runs yet" })).toBeVisible();
  await expect
    .poll(() => harness.config())
    .toMatchObject({ name: "New project", defaultBinding: null });
  await expect(page.getByRole("button", { name: "Create loop" })).toBeVisible();
  await page.getByRole("button", { name: "Loops" }).click();
  await expect(page.getByRole("heading", { name: "No user loops yet" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "No runs yet" })).toBeVisible();
  expect(harness.connections).toHaveLength(0);
});

test("demo and optional template do not enter real project history", async ({ page, harness }) => {
  await page.goto(harness.origin);
  await page.getByRole("button", { name: "Open demo factory" }).click();
  await expect(page.getByRole("heading", { name: "Sample runs" })).toBeVisible();
  await expect.poll(() => harness.config()).toBeNull();
  await page.getByRole("button", { name: "Exit demo" }).click();
  await expect(page.getByRole("heading", { name: "Connect your first project" })).toBeVisible();
  await page.getByRole("textbox", { name: "Project name" }).fill("Real project");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.getByRole("button", { name: "Use starter template" }).click();
  await expect(
    page.getByText("Choose a starter in the loops library to create a draft."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use starter template" }).click();
  await expect(page.getByRole("heading", { name: "Implement → Review → Validate" })).toBeVisible();
  const counts = await page.request.get(`${harness.origin}/api/factory`);
  expect(await counts.json()).toMatchObject({ runs: 0 });
});

test("discovery, verification, authentication, and unsupported providers stay distinct", async ({
  page,
  harness,
}) => {
  await page.goto(harness.origin);
  await expect(page.getByRole("button", { name: /Kiro.*Executable detected/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cursor.*Executable detected/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Claude Code.*Not detected/ })).toBeVisible();
  expect(harness.connections).toHaveLength(0);
  await page.getByRole("button", { name: /Kiro.*Executable detected/ }).click();
  await expect(page.getByRole("combobox", { name: "Project default model" })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("unavailable");
  await page.getByRole("button", { name: /Codex.*Executable detected/ }).click();
  harness.setInspection("unauthenticated");
  await page.getByRole("button", { name: "Verify connection" }).click();
  await expect(page.getByText(/Authentication required\. Sign in/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Project default model" })).toBeDisabled();
  harness.setInspection("authenticated");
  await page.getByRole("button", { name: "Recheck connection" }).click();
  await expect(page.getByRole("option", { name: "Model A" })).toBeAttached();
  await expect(page.getByRole("combobox", { name: "Project default model" })).toBeEnabled();
  expect(harness.connections).toHaveLength(2);
});

test("authenticated Kiro exposes its model catalog and persists the chosen binding", async ({
  page,
  harness,
}) => {
  await page.goto(harness.origin);
  await page.getByRole("textbox", { name: "Project name" }).fill("Kiro project");
  await page.getByRole("button", { name: /Kiro.*Executable detected/ }).click();
  const model = page.getByRole("combobox", { name: "Project default model" });
  await expect(model).toBeDisabled();
  await page.getByRole("button", { name: "Verify connection" }).click();
  await expect(model).toBeEnabled();
  await model.selectOption("kiro-fast");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect
    .poll(() => harness.config())
    .toMatchObject({ defaultBinding: { provider: "kiro", model: "kiro-fast" } });
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("Project default: kiro · kiro-fast")).toBeVisible();
  await page.getByRole("button", { name: "Edit project setup" }).click();
  await expect(page.getByRole("combobox", { name: "Project default model" })).toHaveValue(
    "kiro-fast",
  );
});

test("a machine with only Claude Code verifies it and persists model and effort", async ({
  page,
  harness,
}) => {
  harness.setCandidates([
    candidate("codex"),
    candidate("cursor"),
    candidate("kiro"),
    candidate("claude-code", true),
    candidate("custom"),
  ]);
  await page.goto(harness.origin);
  await page.getByRole("textbox", { name: "Project name" }).fill("Claude project");
  await page.getByRole("button", { name: /Claude Code.*Executable detected/ }).click();
  await page.getByRole("button", { name: "Verify connection" }).click();
  await expect(page.getByText(/Claude Code 2\.1\.295 · Connected/)).toBeVisible();
  const model = page.getByRole("combobox", { name: "Project default model" });
  await expect(model).toBeEnabled();
  await model.selectOption("sonnet");
  await page.getByRole("combobox", { name: "Effort" }).selectOption("xhigh");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect
    .poll(() => harness.config())
    .toMatchObject({
      defaultBinding: { provider: "claude-code", model: "sonnet", effort: "xhigh" },
    });
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("Project default: claude-code · sonnet")).toBeVisible();
});

test("verified model and effort are saved and survive reload", async ({ page, harness }) => {
  await page.goto(harness.origin);
  await page.getByRole("textbox", { name: "Project name" }).fill("Model project");
  await page.getByRole("button", { name: /Codex.*Executable detected/ }).click();
  await page.getByRole("button", { name: "Verify connection" }).click();
  await expect(page.getByRole("combobox", { name: "Project default model" })).toBeEnabled();
  await page.getByRole("combobox", { name: "Project default model" }).selectOption("model-a");
  await page.getByRole("combobox", { name: "Effort" }).selectOption("high");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("heading", { name: "No runs yet" })).toBeVisible();
  await expect
    .poll(() => harness.config())
    .toMatchObject({
      defaultBinding: { provider: "codex", model: "model-a", effort: "high" },
    });
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Edit project setup" }).click();
  await expect(page.getByRole("combobox", { name: "Project default model" })).toHaveValue(
    "model-a",
  );
  await expect(page.getByRole("combobox", { name: "Effort" })).toHaveValue("high");
});

test("a saved model missing from a refreshed catalog stays visible until changed", async ({
  page,
  harness,
}) => {
  await page.goto(harness.origin);
  await page.getByRole("textbox", { name: "Project name" }).fill("Catalog project");
  await page.getByRole("button", { name: /Codex.*Executable detected/ }).click();
  await page.getByRole("button", { name: "Verify connection" }).click();
  await page.getByRole("combobox", { name: "Project default model" }).selectOption("model-a");
  await page.getByRole("button", { name: "Finish setup" }).click();
  harness.setModels([{ id: "model-b", displayName: "Model B", efforts: [] }]);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Edit project setup" }).click();
  await page.getByRole("button", { name: "Recheck connection" }).click();
  await expect(page.getByRole("option", { name: "model-a (unavailable)" })).toBeAttached();
  await expect(page.getByRole("combobox", { name: "Project default model" })).toHaveValue(
    "model-a",
  );
  await expect
    .poll(() => harness.config())
    .toMatchObject({
      defaultBinding: { provider: "codex", model: "model-a" },
    });
  await page.getByRole("combobox", { name: "Project default model" }).selectOption("model-b");
  await page.getByRole("button", { name: "Save project" }).click();
  await expect
    .poll(() => harness.config())
    .toMatchObject({
      defaultBinding: { provider: "codex", model: "model-b" },
    });
});

test("switching provider clears an incompatible draft model", async ({ page, harness }) => {
  await page.goto(harness.origin);
  await page.getByRole("button", { name: /Codex.*Executable detected/ }).click();
  await page.getByRole("button", { name: "Verify connection" }).click();
  await page.getByRole("combobox", { name: "Project default model" }).selectOption("model-a");
  await page.getByRole("combobox", { name: "Effort" }).selectOption("high");
  await page.getByRole("button", { name: /Kiro.*Executable detected/ }).click();
  await expect(page.getByRole("combobox", { name: "Project default model" })).toHaveValue(
    "agent-default",
  );
  await expect(page.getByRole("combobox", { name: "Effort" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Project name" }).fill("Cannot bind Kiro yet");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("heading", { name: "Connect your first project" })).toBeVisible();
  await expect.poll(() => harness.config()).toBeNull();
});

test("connection handshake failure preserves the draft and allows retry", async ({
  page,
  harness,
}) => {
  harness.setInspection("error");
  await page.goto(harness.origin);
  await page.getByRole("textbox", { name: "Project name" }).fill("Retry project");
  await page.getByRole("button", { name: /Codex.*Executable detected/ }).click();
  await page.getByRole("button", { name: "Verify connection" }).click();
  await expect(page.locator("#setup-error")).toContainText("Handshake failed");
  await expect(page.getByRole("combobox", { name: "Project default model" })).toBeDisabled();
  harness.setInspection("authenticated");
  await page.getByRole("button", { name: "Verify connection" }).click();
  await expect(page.getByRole("combobox", { name: "Project default model" })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("Retry project");
});

test("custom executable requires a path and explicit handshake", async ({ page, harness }) => {
  await page.goto(harness.origin);
  await page.getByRole("button", { name: /Custom.*Not detected/ }).click();
  await expect(page.getByRole("button", { name: "Verify connection" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Custom executable" }).fill("relative/codex");
  await page.getByRole("button", { name: "Verify connection" }).click();
  await expect(page.locator("#setup-error")).toContainText("absolute executable path");
  expect(harness.connections).toHaveLength(0);
  await page.getByRole("textbox", { name: "Custom executable" }).fill(process.execPath);
  await page.getByRole("button", { name: "Verify connection" }).click();
  await expect(page.getByRole("combobox", { name: "Project default model" })).toBeEnabled();
  await page.getByRole("textbox", { name: "Project name" }).fill("Custom project");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect
    .poll(() => harness.config())
    .toMatchObject({
      customAgent: { executable: process.execPath, protocol: "codex-app-server" },
      defaultBinding: { provider: "custom", model: "agent-default" },
    });
});

test("save conflict reports an error and reload can recover without overwriting files", async ({
  page,
  harness,
}) => {
  await page.goto(harness.origin);
  await mkdir(join(harness.projectDirectory, ".codex"));
  await writeFile(join(harness.projectDirectory, ".codex", "settings.toml"), "keep = true\n");
  await page.getByRole("textbox", { name: "Project name" }).fill("First name");
  await writeFile(
    join(harness.projectDirectory, ".code-factory", "project.json"),
    JSON.stringify({ schemaVersion: 1, name: "External", defaultBinding: null }),
  ).catch(async () => {
    await mkdir(join(harness.projectDirectory, ".code-factory"));
    await writeFile(
      join(harness.projectDirectory, ".code-factory", "project.json"),
      JSON.stringify({ schemaVersion: 1, name: "External", defaultBinding: null }),
    );
  });
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("alert")).toContainText("changed on disk");
  await expect.poll(() => harness.config()).toMatchObject({ name: "External" });
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Edit project setup" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Retried name");
  await page.getByRole("button", { name: "Save project" }).click();
  await expect.poll(() => harness.config()).toMatchObject({ name: "Retried name" });
  expect(await readFile(join(harness.projectDirectory, ".codex", "settings.toml"), "utf8")).toBe(
    "keep = true\n",
  );
});

test("corrupt existing configuration is reported and never overwritten by onboarding", async ({
  page,
  harness,
}) => {
  const folder = join(harness.projectDirectory, ".code-factory");
  await mkdir(folder, { recursive: true });
  const configPath = join(folder, "project.json");
  await writeFile(configPath, "{broken json");
  await page.goto(harness.origin);
  await expect(page.getByRole("alert")).toContainText("Invalid project configuration");
  expect(await readFile(configPath, "utf8")).toBe("{broken json");
  await writeFile(
    configPath,
    JSON.stringify({ schemaVersion: 1, name: "Repaired", defaultBinding: null }),
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "No runs yet" })).toBeVisible();
});

test("recheck reflects changed discovery without launching an agent", async ({ page, harness }) => {
  await page.goto(harness.origin);
  harness.setCandidates([
    candidate("codex", false),
    candidate("cursor", false),
    candidate("kiro", false),
    candidate("claude-code", false),
    candidate("custom"),
  ]);
  await page.getByRole("button", { name: "Recheck agents" }).click();
  await expect(page.getByRole("button", { name: /Codex.*Not detected/ })).toBeVisible();
  expect(harness.connections).toHaveLength(0);
});

test("keyboard can select and verify an agent, then save with Enter", async ({ page, harness }) => {
  await page.goto(harness.origin);
  await page.getByRole("textbox", { name: "Project name" }).fill("Keyboard project");
  await page.getByRole("button", { name: /Codex.*Executable detected/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Codex.*Executable detected/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Verify connection" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name: "Project default model" })).toBeEnabled();
  await page.getByRole("textbox", { name: "Project name" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "No runs yet" })).toBeVisible();
  await expect.poll(() => harness.config()).toMatchObject({ name: "Keyboard project" });
});
