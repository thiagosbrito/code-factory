import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createViteServer } from "vite";
import { expect, test as base } from "@playwright/test";
import {
  type AdapterEvent,
  type AgentConnection,
  type StepExecutionInput,
  type StepSession,
} from "../../../src/adapters/contract.js";
import { ConnectionRegistry } from "../../../src/runtime/connections.js";
import { startLocalServer } from "../../../src/runtime/server.js";
import { trustProject } from "../../../src/runtime/trust.js";

export type Harness = {
  origin: string;
  projectDirectory: string;
  releaseReviews: () => void;
  setFailFirstReview: (value: boolean) => void;
  setBlockFirstTestReview: (value: boolean) => void;
  setRequestInput: (value: boolean) => void;
  inputReplies: Record<string, { answers: string[] }>[];
  steered: string[];
};

export const detectedCodex: AgentConnection = {
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

/**
 * Rejects when the step is canceled. A cancel can land before the fixture reaches its wait (while
 * the scheduler stores the started event), and an abort event never fires twice, so check first.
 */
export const untilAborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

export const test = base.extend<{ harness: Harness }>({
  harness: async ({ browserName: _browserName }, use) => {
    // A disposable parent keeps every Git artifact of the journey inside one removable folder.
    const parentDirectory = await mkdtemp(join(tmpdir(), "code-factory-e2e-"));
    const projectDirectory = join(parentDirectory, "repo");
    await mkdir(projectDirectory);
    await writeFile(join(projectDirectory, "README.md"), "# Fixture project\n");
    execFileSync("git", ["init", "-q"], { cwd: projectDirectory });
    // Test-only local identity for Code Factory's run-branch commits.
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: projectDirectory });
    execFileSync("git", ["config", "user.email", "fixture@example.test"], {
      cwd: projectDirectory,
    });
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
    let blockFirstTestReview = false;
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
          // Real adapters stream text in small chunks; reviews finish their sentence after the gate.
          yield { type: "message", text: "Fixture ", ...session };
          yield { type: "message", text: "executing ", ...session };
          if (!input.stepId.endsWith("-review") || input.attempt !== 1)
            yield { type: "message", text: input.stepId, ...session };
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
              untilAborted(signal),
            ]);
          }
          if (input.stepId === "implement")
            await writeFile(join(input.projectDirectory, "fixture-output.txt"), "fixture change\n");
          if (input.stepId.endsWith("-review") && input.attempt === 1)
            await Promise.race([reviewGate, untilAborted(signal)]);
          signal.throwIfAborted();
          if (input.stepId.endsWith("-review") && input.attempt === 1)
            yield { type: "message", text: input.stepId, ...session };
          const failsFirstReview =
            failFirstReview &&
            (input.stepId === "quality-review" || input.stepId === "review") &&
            input.attempt === 1;
          // A reviewer that could not run its checks returns the `blocked` verdict once.
          if (blockFirstTestReview && input.stepId === "test-review" && input.attempt === 1) {
            yield {
              type: "completed",
              outcome: "succeeded",
              output: "blocked\nCannot run pnpm test: shell refused.",
              ...session,
            };
            return;
          }
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
    // Journeys run in a project the user already trusts, unless a journey revokes it first.
    await trustProject(projectDirectory);
    let ui: Awaited<ReturnType<typeof createViteServer>> | undefined;
    const runtime = await startLocalServer({
      sessionToken: null,
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
        setBlockFirstTestReview: (value) => {
          blockFirstTestReview = value;
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
      await rm(parentDirectory, { recursive: true, force: true });
    }
  },
});

/** Codex steps ask for tool permission once per page session; these journeys keep the default. */
/**
 * Waits on run progress, not on the UI. Before its reviews start, the starter loop runs eight steps
 * in order, three of them gate checks that each launch Node; on a busy machine that outlasts the
 * 7.5 s default meant for UI reactions, and so can canceling while a check's process exits.
 */
export const runProgress = expect.configure({ timeout: 30_000 });

export const executeWithDefaultTools = async (
  page: import("@playwright/test").Page,
  options: { trustFirst?: boolean } = {},
) => {
  await page.getByRole("button", { name: "Execute run" }).click();
  if (options.trustFirst) {
    const trust = page.getByRole("dialog", { name: "Trust this project?" });
    await expect(trust).toContainText("Code Factory will run this project's check");
    await trust.getByRole("button", { name: "Trust project" }).click();
    await expect(trust).toHaveCount(0);
  }
  const prompt = page.getByRole("dialog", {
    name: "Allow Codex to run commands outside its sandbox?",
  });
  await prompt.getByRole("button", { name: "Keep commands sandboxed" }).click();
  await expect(prompt).toHaveCount(0);
};

export const finishSetup = async (page: import("@playwright/test").Page, origin: string) => {
  await page.goto(origin);
  await page.getByRole("textbox", { name: "Project name" }).fill("Browser project");
  await page.getByRole("button", { name: /Codex.*Executable detected/ }).click();
  await page.getByRole("button", { name: "Verify connection" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();
};
