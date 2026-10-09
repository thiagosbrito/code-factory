import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockAdapter } from "../src/adapters/mock.js";
import { cancelRun, executeRun } from "../src/runtime/scheduler.js";
import { createRun, readRun } from "../src/runtime/storage.js";
import { createRunRecord, createRunSnapshot } from "../src/domain/run.js";
import { run, step } from "./support/scheduler.js";

describe("portable scheduler", () => {
  it("persists one launch and its native session identity across duplicate execute requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-scheduler-"));
    try {
      const workspace = join(root, ".code-factory", "workspaces", "candidate");
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, "task.txt"), "baseline");
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
      let launches = 0;
      const adapter = {
        ...mockAdapter,
        async *execute(input: Parameters<typeof mockAdapter.execute>[0], signal: AbortSignal) {
          launches++;
          yield* mockAdapter.execute(input, signal);
        },
      };
      const [first, second] = await Promise.all([
        executeRun(root, record.snapshot.id, () => adapter),
        executeRun(root, record.snapshot.id, () => adapter),
      ]);
      expect(launches).toBe(1);
      expect(first.status).toBe("succeeded");
      expect(second.revision).toBe(first.revision);
      expect(first.steps[0]?.attempts[0]).toMatchObject({
        status: "succeeded",
        sessionId: expect.any(String),
        turnId: expect.any(String),
      });
      expect((await readRun(root, record.snapshot.id))?.evidence.map((item) => item.kind)).toEqual([
        "event",
        "event",
        "event",
      ]);
      expect(await readFile(join(workspace, "task.txt"), "utf8")).toBe("baseline");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs parallel reviews on frozen copies and preserves their shared candidate hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-reviews-"));
    try {
      const workspace = join(root, ".code-factory", "workspaces", "candidate");
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, "task.txt"), "baseline");
      const seed = run();
      const record = createRunRecord(
        createRunSnapshot(
          seed.snapshot.loop,
          {
            description: "Task",
            ticket: {
              id: "THI-10",
              title: "Requested change",
              summary: "Build the scheduler",
              attachments: [{ title: "Spec", url: "https://example.com/spec" }],
            },
          },
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
      const seen = new Map<string, string>();
      const instructions = new Map<string, string>();
      const adapter = {
        ...mockAdapter,
        async *execute(input: Parameters<typeof mockAdapter.execute>[0], signal: AbortSignal) {
          instructions.set(input.stepId, input.instruction);
          if (input.stepId === "build")
            await writeFile(join(input.projectDirectory, "task.txt"), "candidate");
          if (input.stepId === "quality")
            seen.set("quality", await readFile(join(input.projectDirectory, "task.txt"), "utf8"));
          if (input.stepId === "security")
            seen.set("security", await readFile(join(input.projectDirectory, "task.txt"), "utf8"));
          yield* mockAdapter.execute(input, signal);
        },
      };
      const result = await executeRun(root, record.snapshot.id, () => adapter);
      expect(result.status).toBe("succeeded");
      expect(seen.get("quality")).toBe("candidate");
      expect(seen.get("security")).toBe("candidate");
      expect(instructions.get("build")).toContain("Task description:\nTask");
      expect(instructions.get("build")).toContain("THI-10: Requested change");
      expect(instructions.get("build")).toContain("Spec: https://example.com/spec");
      expect(instructions.get("join")).toContain("Input from quality");
      expect(instructions.get("join")).toContain("Input from security");
      expect(await readFile(join(workspace, "task.txt"), "utf8")).toBe("candidate");
      const reviews = result.evidence
        .filter((item) => item.kind === "review")
        .filter((item) => ["quality", "security"].includes(item.stepId));
      expect(reviews).toHaveLength(2);
      expect(reviews[0]?.provenance.candidateId).toBe(reviews[1]?.provenance.candidateId);
      expect(reviews[0]?.inputHash).toBe(reviews[1]?.inputHash);
      const joined = result.steps.find((item) => item.stepId === "join");
      expect(joined?.inputHash).toBeTruthy();
      const joinReceipt = result.evidence.find(
        (item) => item.kind === "review" && item.stepId === "join",
      );
      expect(
        joinReceipt?.kind === "review" && [...joinReceipt.provenance.inputReceiptIds].sort(),
      ).toEqual(reviews.map((item) => item.id).sort());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a check that mutates its input candidate and marks its receipt stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-check-"));
    try {
      const workspace = join(root, ".code-factory", "workspaces", "candidate");
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, "task.txt"), "before");
      const seed = run({
        steps: [
          {
            id: "check",
            name: "Check",
            kind: "check",
            stage: "validation",
            role: "checker",
            instruction: "printf after > task.txt",
          },
        ],
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
      const result = await executeRun(root, record.snapshot.id, () => mockAdapter);
      const receipt = result.evidence.find((item) => item.kind === "check");
      expect(result.status).toBe("failed");
      expect(receipt?.kind === "check" && receipt.outcome).toBe("failed");
      expect(receipt?.kind === "check" && receipt.freshness.state).toBe("superseded");
      expect(receipt?.kind === "check" && receipt.provenance.candidateId).toBe(
        result.steps[0]?.candidateId,
      );
      expect(await readFile(join(workspace, "task.txt"), "utf8")).toBe("after");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "cancels a check's descendant process before it can write to the workspace",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "factory-check-cancel-"));
      try {
        const workspace = join(root, ".code-factory", "workspaces", "candidate");
        await mkdir(workspace, { recursive: true });
        const seed = run({
          steps: [
            {
              id: "check",
              name: "Check",
              kind: "check",
              stage: "validation",
              role: "checker",
              instruction: "sh -c 'echo child-ready; sleep 1; echo survived > surviving.txt'",
            },
          ],
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
        const work = executeRun(root, record.snapshot.id, () => mockAdapter);
        let ready = false;
        for (let attempt = 0; attempt < 100 && !ready; attempt++) {
          const current = await readRun(root, record.snapshot.id);
          ready = !!current?.evidence.some(
            (item) => item.kind === "event" && item.detail?.includes("child-ready"),
          );
          if (!ready) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(ready).toBe(true);
        const result = await cancelRun(root, record.snapshot.id);
        await work;
        expect(result.status).toBe("canceled");
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        await expect(readFile(join(workspace, "surviving.txt"), "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("rejects a review that changes its frozen candidate copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-frozen-"));
    try {
      const workspace = join(root, ".code-factory", "workspaces", "candidate");
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, "task.txt"), "candidate");
      const seed = run({ steps: [step("review")], dependencies: [], groups: [], joins: [] });
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
      const adapter = {
        ...mockAdapter,
        async *execute(input: Parameters<typeof mockAdapter.execute>[0], signal: AbortSignal) {
          await writeFile(join(input.projectDirectory, "task.txt"), "changed during review");
          yield* mockAdapter.execute(input, signal);
        },
      };
      const result = await executeRun(root, record.snapshot.id, () => adapter);
      expect(result.status).toBe("failed");
      expect(result.evidence.filter((item) => item.kind === "review")).toHaveLength(0);
      expect(await readFile(join(workspace, "task.txt"), "utf8")).toBe("candidate");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
