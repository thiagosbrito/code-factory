import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createViteServer } from "vite";
import { expect, test as base } from "@playwright/test";
import type {
  AdapterEvent,
  AgentConnection,
  StepExecutionInput,
  StepSession,
} from "../../src/adapters/contract.js";
import { ConnectionRegistry } from "../../src/runtime/connections.js";
import { startLocalServer } from "../../src/runtime/server.js";

type Harness = {
  origin: string;
  releaseReviews: () => void;
  setFailFirstReview: (value: boolean) => void;
  steered: string[];
};

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
    await writeFile(join(projectDirectory, "README.md"), "# Fixture project\n");
    execFileSync("git", ["init", "-q"], { cwd: projectDirectory });
    execFileSync("git", ["add", "README.md"], { cwd: projectDirectory });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-qm",
        "fixture",
      ],
      { cwd: projectDirectory },
    );
    let releaseReviews = () => {};
    const reviewGate = new Promise<void>((resolve) => {
      releaseReviews = resolve;
    });
    const steered: string[] = [];
    let failFirstReview = false;
    const sessions = new Map<string, StepSession>();
    const guidanceBySession = new Map<string, string>();
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
        provider: "codex" as const,
        capabilities: { streaming: "supported", steering: "supported", resume: "supported" },
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
        async *execute(
          input: StepExecutionInput,
          signal: AbortSignal,
        ): AsyncIterable<AdapterEvent> {
          signal.throwIfAborted();
          const session = {
            runId: input.runId,
            stepId: input.stepId,
            attempt: input.attempt,
            sessionId: randomUUID(),
            turnId: randomUUID(),
          };
          sessions.set(session.sessionId, session);
          yield { type: "started", ...session };
          yield { type: "message", text: `Fixture executing ${input.stepId}`, ...session };
          if (input.stepId === "implement")
            await writeFile(join(input.projectDirectory, "fixture-output.txt"), "fixture change\n");
          if (input.stepId.endsWith("-review") && input.attempt === 1) await reviewGate;
          signal.throwIfAborted();
          const failsFirstReview =
            failFirstReview &&
            (input.stepId === "quality-review" || input.stepId === "review") &&
            input.attempt === 1;
          const acknowledgment = guidanceBySession
            .get(session.sessionId)
            ?.match(/GUIDANCE-ACK:[\w-]+/)?.[0];
          yield {
            type: "completed",
            outcome: failsFirstReview ? "failed" : "succeeded",
            output: failsFirstReview
              ? "repair\nFixture finding"
              : input.stepId === "adjudicate"
                ? "pass"
                : `pass\nFixture evidence complete${acknowledgment ? `\n${acknowledgment}` : ""}`,
            ...session,
          };
        },
        async *attach(session: StepSession): AsyncIterable<AdapterEvent> {
          yield { type: "message", text: "Fixture session attached", ...session };
        },
        async steer(session: StepSession, guidance: string) {
          if (sessions.has(session.sessionId)) {
            steered.push(guidance);
            guidanceBySession.set(session.sessionId, guidance);
          }
          return "supported" as const;
        },
      }),
    );
    let ui: Awaited<ReturnType<typeof createViteServer>> | undefined;
    const runtime = await startLocalServer({
      projectDirectory,
      port: 0,
      connections: registry,
      tracker: {
        async retrieve(id) {
          return {
            id,
            title: "Complete browser acceptance",
            summary: "Exercise the deterministic end-to-end run.",
            attachments: [],
          };
        },
      },
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
      await use({
        origin,
        releaseReviews,
        setFailFirstReview: (value) => {
          failFirstReview = value;
        },
        steered,
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
  await page.getByRole("button", { name: "Execute run" }).click();

  await expect(page.getByRole("button", { name: /Code quality review, running/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /React and accessibility review, running/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Code quality review, running/ }).click();
  const guidance = page.getByLabel("Message for selected attempt");
  await guidance.fill("Check the accessible name before completing review.");
  await page.getByRole("button", { name: "Queue guidance" }).click();
  await expect
    .poll(() =>
      harness.steered.some((message) =>
        message.startsWith("Check the accessible name before completing review."),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Close inspector" }).click();

  harness.releaseReviews();
  await expect
    .poll(async () => {
      const response = await page.request.get(`${harness.origin}/api/runs`);
      const body = (await response.json()) as {
        runs: { status: string; steps: { stepId: string; status: string; outcome?: string }[] }[];
      };
      return JSON.stringify({ runStatus: body.runs[0]?.status, steps: body.runs[0]?.steps });
    })
    .toContain('"runStatus":"succeeded"');
  await expect
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
  await expect(page.getByRole("button", { name: /Code quality review, succeeded/ })).toBeVisible();
  await page
    .getByRole("button", { name: /Changed files/ })
    .first()
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
  await page.getByRole("button", { name: "Execute run" }).click();

  const failedReview = page.getByRole("button", { name: /Review, failed, 1 attempts/ });
  await expect(failedReview).toBeVisible();
  await failedReview.click();
  await page.getByRole("button", { name: "Retry…" }).click();
  await page.getByRole("button", { name: "Start Attempt 2" }).click();
  await expect(page.getByRole("button", { name: /Review, succeeded, 2 attempts/ })).toBeVisible();
  await expect
    .poll(async () => {
      const response = await page.request.get(`${harness.origin}/api/runs`);
      const body = (await response.json()) as { runs: { status: string }[] };
      return body.runs[0]?.status;
    })
    .toBe("succeeded");
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
