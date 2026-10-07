import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentAdapter } from "../src/adapters/contract.js";
import { mockAdapter } from "../src/adapters/mock.js";
import { createLoopDraft, parseLoop } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot } from "../src/domain/run.js";
import { executeRun } from "../src/runtime/scheduler.js";
import { createRun } from "../src/runtime/storage.js";
import { kiroWorkflowTranslator } from "../src/translators/kiro-workflow.js";

// A faithful answer to the Kiro acceptance prompt: a multi-line status report, not an outcome.
const acceptanceReport = (round: number) =>
  [
    `Acceptance round ${round}`,
    "Finalize helper exit code: 0",
    `Verdict: ${round === 1 ? "FAIL" : "PASS"} (observed, not intended)`,
    "- react-review: pass",
    "- business-review: pass",
  ].join("\n");

/**
 * The mock protocol fixture with scripted outputs for the Kiro acceptance step and the
 * importer-generated decision step; every other step keeps the mock's own output.
 */
const scriptedMock = (instructions: Map<string, string[]>): AgentAdapter => {
  const rounds = new Map<string, number>();
  const output = (stepId: string, round: number): string | undefined => {
    if (stepId === "acceptance") return acceptanceReport(round);
    if (stepId === "delivery-rounds-decision") return round === 1 ? "continue" : "stop";
    return undefined;
  };
  return {
    ...mockAdapter,
    async *execute(input, signal) {
      const round = (rounds.get(input.stepId) ?? 0) + 1;
      rounds.set(input.stepId, round);
      instructions.set(input.stepId, [
        ...(instructions.get(input.stepId) ?? []),
        input.instruction,
      ]);
      const scripted = output(input.stepId, round);
      for await (const event of mockAdapter.execute(input, signal))
        yield event.type === "completed" && scripted !== undefined
          ? { ...event, output: scripted }
          : event;
    },
  };
};

describe("imported Kiro workflow execution", () => {
  it("runs the focused recipe through the scheduler with a multi-line acceptance report", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-kiro-run-"));
    try {
      const workspace = join(root, ".code-factory", "workspaces", "candidate");
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, "task.txt"), "baseline");
      const text = await readFile(
        new URL("./fixtures/kiro/ui-delivery-focused.workflow.json", import.meta.url),
        "utf8",
      );
      const { loop } = kiroWorkflowTranslator.import(text, createLoopDraft("kiro", "Kiro"));
      // The user binds and publishes the imported draft; the run default binding is mock.
      const published = parseLoop({ ...loop, status: "published" });
      const record = createRunRecord(
        createRunSnapshot(
          published,
          { description: "Deliver the UI change" },
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
      const instructions = new Map<string, string[]>();
      const adapter = scriptedMock(instructions);
      const result = await executeRun(root, record.snapshot.id, () => adapter);

      expect(result.status).toBe("succeeded");
      expect(result.implementationRound).toBe(2);
      const stepState = (id: string) => result.steps.find(({ stepId }) => stepId === id);
      expect(result.steps.every(({ status }) => status === "succeeded")).toBe(true);
      expect(stepState("acceptance")?.outcome).toBe(acceptanceReport(2));
      expect(stepState("delivery-rounds-decision")?.outcome).toBe("stop");

      // Repeat body ran twice; steps before and after it ran once.
      const runs = (id: string) => instructions.get(id)?.length ?? 0;
      expect(runs("prepare")).toBe(1);
      expect(runs("implement-and-prepare")).toBe(2);
      expect(runs("acceptance")).toBe(2);
      expect(runs("delivery-rounds-decision")).toBe(2);
      expect(runs("delivery-rounds-exit")).toBe(1);

      // The Kiro step keeps its own output contract; only the generated step gets outcomes.
      const acceptance = instructions.get("acceptance")?.[0] ?? "";
      expect(acceptance).toContain("Accept the round.");
      expect(acceptance).not.toContain("Return exactly one outcome");
      const decision = instructions.get("delivery-rounds-decision")?.[1] ?? "";
      expect(decision).toContain('"verdict"');
      expect(decision).toContain(`Input from acceptance (outcome: ${acceptanceReport(2)}`);
      expect(decision).toContain("Return exactly one outcome: stop, continue.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
