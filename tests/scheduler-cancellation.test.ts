import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockAdapter } from "../src/adapters/mock.js";
import { CancellationUnconfirmedError, type AdapterEvent } from "../src/adapters/contract.js";
import { cancelRun, executeRun } from "../src/runtime/scheduler.js";
import { createRun, readRun } from "../src/runtime/storage.js";
import { createRunRecord, createRunSnapshot } from "../src/domain/run.js";
import { run, step } from "./support/scheduler.js";

describe("portable scheduler", () => {
  it("aborts an active adapter and records cancellation separately", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-cancel-"));
    try {
      await mkdir(join(root, ".code-factory", "workspaces", "candidate"), { recursive: true });
      const seed = run({
        steps: [step("build", "implementation")],
        dependencies: [],
        groups: [],
        joins: [],
      });
      const record = createRunRecord(
        createRunSnapshot(
          seed.snapshot.loop,
          { description: "Task" },
          { provider: "mock", model: "default" },
          {
            id: "baseline",
            kind: "git",
            revision: "abc",
            workspace: ".code-factory/workspaces/candidate",
            capturedAt: new Date().toISOString(),
          },
        ),
      );
      await createRun(root, record);
      let started: () => void = () => {};
      const launched = new Promise<void>((resolve) => {
        started = resolve;
      });
      const adapter = {
        ...mockAdapter,
        async *execute(
          input: Parameters<typeof mockAdapter.execute>[0],
          signal: AbortSignal,
        ): AsyncIterable<AdapterEvent> {
          yield {
            type: "started",
            runId: input.runId,
            stepId: input.stepId,
            attempt: input.attempt,
            sessionId: crypto.randomUUID(),
            turnId: crypto.randomUUID(),
          };
          started();
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          signal.throwIfAborted();
        },
      };
      const work = executeRun(root, record.snapshot.id, () => adapter);
      await launched;
      const canceled = await cancelRun(root, record.snapshot.id);
      expect(canceled.status).toBe("canceled");
      expect((await work).steps[0]?.attempts[0]?.status).toBe("canceled");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not confirm a canceled run when native interruption fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-cancel-unconfirmed-"));
    try {
      await mkdir(join(root, ".code-factory", "workspaces", "candidate"), { recursive: true });
      const seed = run({
        steps: [step("build", "implementation")],
        dependencies: [],
        groups: [],
        joins: [],
      });
      const record = createRunRecord(
        createRunSnapshot(
          seed.snapshot.loop,
          { description: "Task" },
          { provider: "mock", model: "default" },
          {
            id: "baseline",
            kind: "git",
            revision: "abc",
            workspace: ".code-factory/workspaces/candidate",
            capturedAt: new Date().toISOString(),
          },
        ),
      );
      await createRun(root, record);
      let started: () => void = () => {};
      const launched = new Promise<void>((resolve) => {
        started = resolve;
      });
      const adapter = {
        ...mockAdapter,
        async *execute(
          input: Parameters<typeof mockAdapter.execute>[0],
          signal: AbortSignal,
        ): AsyncIterable<AdapterEvent> {
          yield {
            type: "started",
            runId: input.runId,
            stepId: input.stepId,
            attempt: input.attempt,
            sessionId: crypto.randomUUID(),
            turnId: crypto.randomUUID(),
          };
          started();
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          throw new CancellationUnconfirmedError("Native interruption failed.");
        },
      };
      const work = executeRun(root, record.snapshot.id, () => adapter);
      await launched;
      const result = await cancelRun(root, record.snapshot.id);
      expect(await work).toEqual(result);
      expect(result.status).toBe("unavailable");
      expect(result.status).not.toBe("canceled");
      expect(result.steps[0]?.attempts[0]?.status).toBe("failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cancels an adapter while its active attempt is waiting for native input", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-cancel-input-"));
    try {
      await mkdir(join(root, ".code-factory", "workspaces", "candidate"), { recursive: true });
      const seed = run({
        steps: [step("build", "implementation")],
        dependencies: [],
        groups: [],
        joins: [],
      });
      const record = createRunRecord(
        createRunSnapshot(
          seed.snapshot.loop,
          { description: "Task" },
          { provider: "mock", model: "default" },
          {
            id: "baseline",
            kind: "git",
            revision: "abc",
            workspace: ".code-factory/workspaces/candidate",
            capturedAt: new Date().toISOString(),
          },
        ),
      );
      await createRun(root, record);
      let requested: () => void = () => {};
      const inputRequested = new Promise<void>((resolve) => {
        requested = resolve;
      });
      const adapter = {
        ...mockAdapter,
        capabilities: { ...mockAdapter.capabilities, waitingInput: "supported" as const },
        async *execute(
          input: Parameters<typeof mockAdapter.execute>[0],
          signal: AbortSignal,
        ): AsyncIterable<AdapterEvent> {
          const session = {
            runId: input.runId,
            stepId: input.stepId,
            attempt: input.attempt,
            sessionId: crypto.randomUUID(),
            turnId: crypto.randomUUID(),
          };
          yield { type: "started", ...session };
          yield {
            type: "input-request",
            ...session,
            requestId: 0,
            itemId: "item-1",
            questions: [{ id: "choice", header: "Choice", question: "Choose", options: [] }],
            isBlocking: true,
            autoResolutionMs: null,
          };
          requested();
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          signal.throwIfAborted();
        },
      };
      const work = executeRun(root, record.snapshot.id, () => adapter);
      await inputRequested;
      expect((await readRun(root, record.snapshot.id))?.status).toBe("waiting-input");
      const canceled = await cancelRun(root, record.snapshot.id);
      expect(canceled.status).toBe("canceled");
      expect((await work).steps[0]?.attempts[0]?.status).toBe("canceled");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("executes one repair and retains changed files after a second review rejection", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-repair-"));
    try {
      const workspace = join(root, ".code-factory", "workspaces", "candidate");
      await mkdir(workspace, { recursive: true });
      const seed = run({
        steps: [
          step("build", "implementation", "repair"),
          step("review", "review", "repair"),
          step("done"),
        ],
        dependencies: [
          { from: "build", to: "review" },
          { from: "review", to: "done" },
        ],
        groups: [
          {
            id: "repair",
            name: "Repair",
            kind: "repeat",
            stepIds: ["build", "review"],
            maxIterations: 2,
            exitWhen: { stepId: "review", outcome: "pass" },
            continueWhen: { outcome: "changes-requested", to: "build" },
          },
        ],
        joins: [],
        decisions: [
          {
            stepId: "review",
            branches: [
              { outcome: "pass", to: "done" },
              { outcome: "changes-requested", to: "build" },
            ],
          },
        ],
      });
      const record = createRunRecord(
        createRunSnapshot(
          seed.snapshot.loop,
          { description: "Task" },
          { provider: "mock", model: "default" },
          {
            id: "baseline",
            kind: "git",
            revision: "abc",
            workspace: ".code-factory/workspaces/candidate",
            capturedAt: new Date().toISOString(),
          },
        ),
      );
      await createRun(root, record);
      const buildInstructions: string[] = [];
      const adapter = {
        ...mockAdapter,
        async *execute(
          input: Parameters<typeof mockAdapter.execute>[0],
        ): AsyncIterable<AdapterEvent> {
          if (input.stepId === "build") {
            buildInstructions.push(input.instruction);
            await writeFile(join(input.projectDirectory, "result.txt"), `round ${input.attempt}`);
          }
          const identity = {
            runId: input.runId,
            stepId: input.stepId,
            attempt: input.attempt,
            sessionId: crypto.randomUUID(),
            turnId: crypto.randomUUID(),
          };
          yield { type: "started", ...identity };
          yield {
            type: "completed",
            ...identity,
            outcome: "succeeded",
            output:
              input.stepId === "review"
                ? "changes-requested\nFix the result file before approval."
                : "done",
          };
        },
      };
      const result = await executeRun(root, record.snapshot.id, () => adapter);
      expect(result.status).toBe("rejected");
      expect(result.implementationRound).toBe(2);
      expect(result.steps.find((item) => item.stepId === "build")?.attempts).toHaveLength(2);
      expect(buildInstructions[0]).not.toContain("Input from review");
      expect(buildInstructions[1]).toContain("Input from review");
      expect(buildInstructions[1]).toContain("changes-requested");
      expect(buildInstructions[1]).toContain("Fix the result file before approval.");
      expect(result.evidence.filter((item) => item.kind === "review")).toHaveLength(2);
      expect(result.evidence.filter((item) => item.kind === "review")).toEqual([
        expect.objectContaining({ findings: ["Fix the result file before approval."] }),
        expect.objectContaining({ findings: ["Fix the result file before approval."] }),
      ]);
      expect(await readFile(join(workspace, "result.txt"), "utf8")).toBe("round 2");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
