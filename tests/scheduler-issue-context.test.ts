import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeRun, retryStep } from "../src/runtime/scheduler.js";
import { createRun } from "../src/runtime/storage.js";
import { createRunRecord, createRunSnapshot, type RunRecord } from "../src/domain/run.js";
import { type ScriptedInstructions, run, scriptedAdapter, step } from "./support/scheduler.js";

/** A persisted ticket-only run whose issue the agent must read through its own MCP. */
const ticketRun = async (
  root: string,
  steps: ReturnType<typeof step>[],
  dependencies: { from: string; to: string }[],
): Promise<RunRecord> => {
  await mkdir(join(root, ".code-factory", "workspaces", "candidate"), { recursive: true });
  const seed = run({ steps, dependencies, groups: [], joins: [] });
  const record = createRunRecord(
    createRunSnapshot(
      seed.snapshot.loop,
      { description: "", ticketId: "PROJ-123" },
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
  return record;
};

describe("portable scheduler", () => {
  it.each([
    ["provider-neutral", "BLOCKED: Issue PROJ-123 could not be retrieved; MCP unavailable"],
    ["legacy Jira", "BLOCKED: Jira issue PROJ-123 could not be retrieved; MCP unavailable"],
  ])(
    "asks the entry step to read the issue and fails it on the %s sentinel",
    async (_label, blocked) => {
      const root = await mkdtemp(join(tmpdir(), "factory-issue-mcp-"));
      try {
        const record = await ticketRun(root, [step("build", "implementation")], []);
        const instructions: ScriptedInstructions = {};
        const result = await executeRun(root, record.snapshot.id, () =>
          scriptedAdapter({ build: [blocked, "Built"] }, instructions),
        );
        expect(instructions.build?.[0]).toContain("use the issue tracker MCP");
        expect(instructions.build?.[0]).toContain("BLOCKED: Issue PROJ-123 could not be retrieved");
        expect(result.steps[0]?.status).toBe("failed");
        expect(result.status).toBe("failed");
        const attemptId = result.steps[0]?.attempts.at(-1)?.id;
        if (!attemptId) throw new Error("Missing issue lookup attempt");
        const resumed = await retryStep(root, record.snapshot.id, "build", attemptId, () =>
          scriptedAdapter({ build: ["Built"] }, instructions),
        );
        // The blocked attempt never succeeded, so the retry asks for the lookup again.
        expect(instructions.build?.[1]).toContain("use the issue tracker MCP");
        expect(resumed.status).toBe("succeeded");
        expect(resumed.steps[0]?.attempts).toHaveLength(2);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("does not treat a failed agent result as an issue lookup that succeeded", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-issue-failed-"));
    try {
      const record = await ticketRun(root, [step("build", "implementation")], []);
      const result = await executeRun(root, record.snapshot.id, () =>
        scriptedAdapter(
          { build: ["BLOCKED: Issue PROJ-123 could not be retrieved"] },
          {},
          "failed",
        ),
      );
      expect(result.steps[0]?.status).toBe("failed");
      expect(result.steps[0]?.attempts.at(-1)?.status).toBe("failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads the issue only in the entry step and carries the retrieved details to every later step", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-issue-persist-"));
    try {
      const record = await ticketRun(
        root,
        [
          step("plan", "implementation"),
          step("build", "implementation"),
          step("ship", "implementation"),
        ],
        [
          { from: "plan", to: "build" },
          { from: "build", to: "ship" },
        ],
      );
      const retrieved = [
        "--- Retrieved issue PROJ-123 ---",
        "Title: Export invoices",
        "Acceptance criteria: CSV includes totals",
        "--- End retrieved issue ---",
      ].join("\n");
      const instructions: ScriptedInstructions = {};
      const result = await executeRun(root, record.snapshot.id, () =>
        scriptedAdapter(
          { plan: [`Plan ready\n${retrieved}`], build: ["Built"], ship: ["Shipped"] },
          instructions,
        ),
      );
      expect(result.status).toBe("succeeded");
      expect(instructions.plan?.[0]).toContain("use the issue tracker MCP");
      // ship is not a direct dependent of plan, so the details come from persisted evidence.
      for (const later of [instructions.build?.[0], instructions.ship?.[0]]) {
        expect(later).toContain(retrieved);
        expect(later).toContain("do not fetch the issue again");
        expect(later).not.toContain("use the issue tracker MCP");
      }
      expect(instructions.ship?.[0]).not.toContain("Input from plan");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tells later steps the issue was not captured instead of asking for another lookup", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-issue-missing-"));
    try {
      const record = await ticketRun(
        root,
        [step("plan", "implementation"), step("build", "implementation")],
        [{ from: "plan", to: "build" }],
      );
      const instructions: ScriptedInstructions = {};
      await executeRun(root, record.snapshot.id, () =>
        scriptedAdapter({ plan: ["Plan ready without details"], build: ["Built"] }, instructions),
      );
      expect(instructions.build?.[0]).toContain(
        "Issue PROJ-123 details were not captured by the first step",
      );
      expect(instructions.build?.[0]).not.toContain("use the issue tracker MCP");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
