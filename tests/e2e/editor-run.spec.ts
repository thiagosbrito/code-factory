import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  projectDirectory: string;
  releaseReviews: () => void;
  setFailFirstReview: (value: boolean) => void;
  setRequestInput: (value: boolean) => void;
  inputReplies: Record<string, { answers: string[] }>[];
  steered: string[];
};

const detectedCodex: AgentConnection = {
  provider: "codex",
  executable: "/fixture/codex",
  installation: "detected",
  authentication: "unknown",
  capabilities: {
    streaming: "unknown",
    steering: "unknown",
    resume: "unknown",
    pause: "unknown",
    waitingInput: "unknown",
  },
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
    let requestInput = false;
    const inputReplies: Record<string, { answers: string[] }>[] = [];
    const pendingInput = new Map<string, () => void>();
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
          capabilities: {
            streaming: "unknown",
            steering: "unknown",
            resume: "unknown",
            pause: "unknown",
            waitingInput: "unknown",
          },
        },
      ],
      async (executable) => ({
        provider: "codex" as const,
        capabilities: {
          streaming: "supported",
          steering: "supported",
          resume: "supported",
          pause: "unsupported",
          waitingInput: "supported",
        },
        close() {},
        async inspect(): Promise<AgentConnection> {
          return {
            ...detectedCodex,
            executable,
            identity: "Codex CLI",
            version: "0.1.0-fixture",
            protocol: "Codex app-server JSON-RPC over stdio",
            authentication: "authenticated",
            capabilities: {
              streaming: "supported",
              steering: "supported",
              resume: "supported",
              pause: "unsupported",
              waitingInput: "supported",
            },
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
          if (requestInput && input.stepId === "implement") {
            yield {
              type: "input-request",
              requestId: "browser-question",
              itemId: "browser-item",
              questions: [
                {
                  id: "choice",
                  header: "Implementation choice",
                  question: "Which approach should this run use?",
                  options: [],
                },
              ],
              isBlocking: true,
              autoResolutionMs: null,
              ...session,
            };
            await Promise.race([
              new Promise<void>((resolve) => pendingInput.set(session.sessionId, resolve)),
              new Promise<never>((_, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
              ),
            ]);
          }
          if (input.stepId === "implement")
            await writeFile(join(input.projectDirectory, "fixture-output.txt"), "fixture change\n");
          if (input.stepId.endsWith("-review") && input.attempt === 1)
            await Promise.race([
              reviewGate,
              new Promise<never>((_, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
              ),
            ]);
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
        async replyToInput(
          session: StepSession,
          _requestId: string | number,
          answers: Record<string, { answers: string[] }>,
        ) {
          inputReplies.push(answers);
          pendingInput.get(session.sessionId)?.();
          pendingInput.delete(session.sessionId);
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
        releaseReviews,
        setFailFirstReview: (value) => {
          failFirstReview = value;
        },
        setRequestInput: (value) => {
          requestInput = value;
        },
        inputReplies,
        steered,
      });
    } finally {
      releaseReviews();
      for (const resolve of pendingInput.values()) resolve();
      pendingInput.clear();
      await ui?.close();
      registry.close();
      runtime.server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        runtime.server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(projectDirectory, { recursive: true, force: true });
    }
  },
});

const finishSetup = async (page: import("@playwright/test").Page, origin: string) => {
  await page.goto(origin);
  await page.getByRole("textbox", { name: "Project name" }).fill("Browser project");
  await page.getByRole("button", { name: /Codex.*Executable detected/ }).click();
  await page.getByRole("button", { name: "Verify connection" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();
};

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
  const { access } = await import("node:fs/promises");
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
  await page.getByRole("button", { name: "Execute run" }).click();
  await expect(page.getByRole("button", { name: /Code quality review, running/ })).toBeVisible();
  await page.getByRole("button", { name: "Cancel run" }).click();
  await expect
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
  await page.getByRole("button", { name: "Execute run" }).click();
  await expect(page.getByRole("button", { name: /Code quality review, running/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
  harness.releaseReviews();
  await expect
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
  await page.getByRole("button", { name: "Execute run" }).click();

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
  await expect
    .poll(() => harness.inputReplies)
    .toEqual([{ choice: { answers: ["Keep it small"] } }]);
  await expect
    .poll(async () => {
      const response = await page.request.get(`${harness.origin}/api/runs`);
      const body = (await response.json()) as { runs: { status: string }[] };
      return body.runs[0]?.status;
    })
    .toBe("succeeded");
  await expect(restoredPrompt).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Accept evidence" })).toHaveCount(0);
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
  await page.getByRole("button", { name: "Accept evidence" }).click();
  await expect(page.getByText(/Human acceptance:/)).toContainText("accepted");
  await page.reload();
  await page.getByRole("button", { name: "← All runs" }).click();
  await page.getByRole("button", { name: /Exercise selected retry/ }).click();
  await expect(page.getByText(/Human acceptance:/)).toContainText("accepted");
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
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Connect your first project" })).toBeVisible();
  await expect(model).toBeFocused();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Create empty loop" }).first().click();
  await page.getByRole("button", { name: "+ Agent step" }).click();
  await page.getByRole("button", { name: "New agent step", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Step configuration" });
  for (const name of ["Step coding agent", "Join mode"]) {
    const select = drawer.getByRole("combobox", { name });
    await select.scrollIntoViewIfNeeded();
    await expect(select).toBeInViewport();
    await expect(select).toBeEnabled();
  }
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
});
