import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockAdapter } from "../src/adapters/mock.js";
import { CancellationUnconfirmedError, type AdapterEvent } from "../src/adapters/contract.js";
import { cancelRun, executeRun, retryStep } from "../src/runtime/scheduler.js";
import { createRun, readRun, updateRun } from "../src/runtime/storage.js";
import { startLocalServer } from "../src/runtime/server.js";
import { evidenceFreshness } from "../src/ui/features/runs/run-view-model.js";
import { parseLoop } from "../src/domain/loop.js";
import {
  createRunRecord,
  createRunSnapshot,
  runRecordSchema,
  type RunRecord,
} from "../src/domain/run.js";
import {
  claimStep,
  completeStep,
  continueRepeat,
  readySteps,
  settleRun,
  prepareStepRetry,
  retryBlocker,
} from "../src/domain/scheduler.js";
import type { StepExecutionInput } from "../src/adapters/contract.js";
import { initializeProject } from "../src/runtime/project.js";
import {
  grantToolPermission,
  revokeToolPermission,
  trustDirectory,
  trustProject,
} from "../src/runtime/trust.js";

const step = (id: string, stage: "implementation" | "review" = "review", groupId?: string) => ({
  id,
  name: id,
  kind: "agent" as const,
  stage,
  role: id,
  instruction: id,
  ...(groupId ? { groupId } : {}),
});
const run = (input: Record<string, unknown> = {}): RunRecord => {
  const loop = parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 1,
    status: "published",
    steps: [
      step("build", "implementation"),
      step("quality", "review", "reviews"),
      step("security", "review", "reviews"),
      step("join"),
    ],
    dependencies: [
      { from: "build", to: "quality" },
      { from: "build", to: "security" },
      { from: "quality", to: "join" },
      { from: "security", to: "join" },
    ],
    groups: [
      { id: "reviews", name: "Reviews", kind: "parallel", stepIds: ["quality", "security"] },
    ],
    joins: [{ stepId: "join", mode: "all", from: ["quality", "security"] }],
    decisions: [],
    policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 2 },
    ...input,
  });
  return createRunRecord(
    createRunSnapshot(loop, { description: "Task" }, { provider: "mock", model: "default" }),
  );
};
const claim = (record: RunRecord, id: string): RunRecord =>
  claimStep(record, id, "candidate-a", "input-a");
const pass = (record: RunRecord, id: string, outcome?: string): RunRecord =>
  completeStep(record, id, { status: "succeeded", ...(outcome ? { outcome } : {}) });

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
type ScriptedInstructions = Record<string, string[]>;
/** Replies with the next scripted output per step and records each instruction it received. */
const scriptedAdapter = (
  outputs: Record<string, string[]>,
  instructions: ScriptedInstructions,
  outcome: "succeeded" | "failed" = "succeeded",
) => ({
  ...mockAdapter,
  async *execute(input: Parameters<typeof mockAdapter.execute>[0]): AsyncIterable<AdapterEvent> {
    const seen = (instructions[input.stepId] ??= []);
    seen.push(input.instruction);
    const session = {
      runId: input.runId,
      stepId: input.stepId,
      attempt: input.attempt,
      sessionId: crypto.randomUUID(),
      turnId: crypto.randomUUID(),
    };
    yield { type: "started", ...session };
    yield {
      type: "completed",
      outcome,
      output: outputs[input.stepId]?.[seen.length - 1] ?? outputs[input.stepId]?.at(-1) ?? "",
      ...session,
    };
  },
});

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

  it("retries the exact failed attempt, preserves history and siblings, and exhausts attempts independently of rounds", () => {
    let record = pass(claim(run(), "build"), "build");
    record = pass(claim(record, "security"), "security");
    record = completeStep(claim(record, "quality"), "quality", { status: "failed" });
    const failed = record.steps.find((item) => item.stepId === "quality")?.attempts[0];
    if (!failed) throw new Error("Missing failed attempt");
    const historical = {
      id: crypto.randomUUID(),
      runId: record.snapshot.id,
      stepId: "quality",
      attemptId: failed.id,
      createdAt: new Date().toISOString(),
      kind: "artifact" as const,
      name: "review-log",
      mediaType: "text/plain",
      relativePath: "review.txt",
      digest: "old-review",
      provenance: {
        source: "agent" as const,
        baselineId: record.snapshot.baseline.id,
        candidateId: "candidate-a",
        inputReceiptIds: [],
      },
      freshness: { state: "current" as const, checkedAgainstCandidateId: "candidate-a" },
    };
    record = runRecordSchema.parse({ ...record, evidence: [historical] });
    const sibling = record.steps.find((item) => item.stepId === "security");
    const next = prepareStepRetry(record, "quality", failed.id);
    expect(next.implementationRound).toBe(1);
    expect(next.steps.find((item) => item.stepId === "quality")?.status).toBe("pending");
    expect(next.steps.find((item) => item.stepId === "security")).toEqual(sibling);
    expect(next.evidence[0]).toEqual(historical);
    expect(next.evidence.at(-1)).toMatchObject({
      title: "selected-step-retry",
      attemptId: failed.id,
    });
    expect(() => prepareStepRetry(next, "quality", failed.id)).toThrow(/failed run/);
    expect(() => prepareStepRetry(record, "security", failed.id)).toThrow(/failed step/);
    let retried = completeStep(claim(next, "quality"), "quality", { status: "failed" });
    expect(
      retried.steps.find((item) => item.stepId === "quality")?.attempts.map((item) => item.id)[0],
    ).toBe(failed.id);
    expect(retried.steps.find((item) => item.stepId === "quality")?.attempts).toHaveLength(2);
    expect(() =>
      prepareStepRetry(
        retried,
        "quality",
        retried.steps.find((item) => item.stepId === "quality")?.attempts.at(-1)?.id ?? "",
      ),
    ).toThrow(/Attempt limit/);
  });

  it("invalidates completed consumers while keeping an independent completed sibling", () => {
    let record = pass(claim(run(), "build"), "build");
    record = pass(claim(record, "security"), "security");
    record = pass(claim(record, "quality"), "quality");
    record = pass(claim(record, "join"), "join");
    // Model a failed later quality result while retaining an earlier join result.
    const quality = record.steps.find((item) => item.stepId === "quality");
    const previous = quality?.attempts.at(-1);
    if (!previous) throw new Error("Missing quality attempt");
    record = runRecordSchema.parse({
      ...record,
      status: "failed",
      steps: record.steps.map((item) =>
        item.stepId === "quality"
          ? {
              ...item,
              status: "failed",
              attempts: item.attempts.map((attempt) =>
                attempt.id === previous.id ? { ...attempt, status: "failed" } : attempt,
              ),
            }
          : item,
      ),
    });
    const joinAttempt = record.steps.find((item) => item.stepId === "join")?.attempts[0];
    const siblingAttempt = record.steps.find((item) => item.stepId === "security")?.attempts[0];
    if (!joinAttempt || !siblingAttempt) throw new Error("Missing completed attempts");
    const receipt = (stepId: string, attemptId: string) => ({
      id: crypto.randomUUID(),
      runId: record.snapshot.id,
      stepId,
      attemptId,
      createdAt: new Date().toISOString(),
      kind: "artifact" as const,
      name: `${stepId}-result`,
      mediaType: "text/plain",
      relativePath: `${stepId}.txt`,
      digest: stepId,
      provenance: {
        source: "agent" as const,
        baselineId: record.snapshot.baseline.id,
        candidateId: "candidate-a",
        inputReceiptIds: [],
      },
      freshness: { state: "current" as const, checkedAgainstCandidateId: "candidate-a" },
    });
    const downstream = receipt("join", joinAttempt.id);
    const independent = receipt("security", siblingAttempt.id);
    record = runRecordSchema.parse({ ...record, evidence: [downstream, independent] });
    const sibling = record.steps.find((item) => item.stepId === "security");
    const next = prepareStepRetry(record, "quality", previous.id);
    expect(next.steps.find((item) => item.stepId === "join")?.status).toBe("pending");
    expect(next.steps.find((item) => item.stepId === "join")?.attempts).toHaveLength(1);
    expect(next.steps.find((item) => item.stepId === "security")).toEqual(sibling);
    expect(next.evidence.at(-1)).toMatchObject({ title: "retry-invalidated", stepId: "join" });
    expect(next.evidence.slice(0, 2)).toEqual([downstream, independent]);
    expect(evidenceFreshness(next, downstream)).toBe("superseded · needs revalidation");
    expect(evidenceFreshness(next, independent)).toBe("current");
  });

  it("replays only affected descendants after a selected retry, once for duplicate requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-retry-"));
    try {
      const workspace = join(root, ".code-factory", "workspaces", "candidate");
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, "task.txt"), "retained edit");
      const seed = run({
        steps: [step("build", "implementation"), step("quality"), step("security"), step("join")],
        dependencies: [
          { from: "build", to: "quality" },
          { from: "build", to: "security" },
          { from: "quality", to: "join" },
          { from: "security", to: "join" },
        ],
        groups: [],
      });
      let record = createRunRecord(
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
      const persisted = await readRun(root, record.snapshot.id);
      if (!persisted) throw new Error("Missing stored run");
      // Persist the historical transitions as they would occur during execution.
      let current = persisted;
      for (const id of ["build", "security", "quality"]) {
        current = claim(current, id);
        current = await updateRun(root, current);
        current =
          id === "quality" ? completeStep(current, id, { status: "failed" }) : pass(current, id);
        current = await updateRun(root, current);
      }
      record = current;
      const previous = record.steps.find((item) => item.stepId === "quality")?.attempts[0]?.id;
      if (!previous) throw new Error("Missing previous attempt");
      const launches: string[] = [];
      const adapter = {
        ...mockAdapter,
        async *execute(input: Parameters<typeof mockAdapter.execute>[0], signal: AbortSignal) {
          launches.push(input.stepId);
          yield* mockAdapter.execute(input, signal);
        },
      };
      // A terminal run can be visible on disk before its prior execution clears
      // the process-local active entry. The selected retry must wait for cleanup.
      const priorCompletion = executeRun(root, record.snapshot.id, () => adapter);
      const [first, duplicate] = await Promise.all([
        retryStep(root, record.snapshot.id, "quality", previous, () => adapter),
        retryStep(root, record.snapshot.id, "quality", previous, () => adapter),
      ]);
      await priorCompletion;
      expect(first.status).toBe("succeeded");
      expect(duplicate.revision).toBe(first.revision);
      expect(launches).toEqual(["quality", "join"]);
      expect(first.steps.find((item) => item.stepId === "quality")?.attempts).toHaveLength(2);
      expect(first.steps.find((item) => item.stepId === "security")?.attempts).toHaveLength(1);
      expect(await readFile(join(workspace, "task.txt"), "utf8")).toBe("retained edit");
      expect((await readRun(root, record.snapshot.id))?.revision).toBe(first.revision);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("acknowledges the same HTTP retry key after the new attempt starts", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-retry-http-"));
    await trustProject(root);
    const initial = run();
    await createRun(root, initial);
    const claimed = await updateRun(root, claim(initial, "build"));
    const failed = await updateRun(root, completeStep(claimed, "build", { status: "failed" }));
    const attemptId = failed.steps.find((item) => item.stepId === "build")?.attempts[0]?.id;
    if (!attemptId) throw new Error("Missing failed attempt");
    const accepted = prepareStepRetry(failed, "build", attemptId);
    await updateRun(root, accepted);
    const running = await updateRun(root, claim(accepted, "build"));
    const { server, url } = await startLocalServer({
      sessionToken: null,
      projectDirectory: root,
      port: 0,
    });
    try {
      const response = await fetch(`${url}/api/runs/${accepted.snapshot.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: "build", attemptId }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).run.revision).toBe(running.revision);
      expect((await readRun(root, accepted.snapshot.id))?.steps[0]?.attempts).toHaveLength(2);
      expect((await readRun(root, accepted.snapshot.id))?.steps[0]?.status).toBe("running");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
  it("waits for both explicit join sources while parallel reviewers retain independent attempts", () => {
    let record = run();
    expect(readySteps(record).map((item) => item.id)).toEqual(["build"]);
    record = pass(claim(record, "build"), "build");
    expect(readySteps(record).map((item) => item.id)).toEqual(["quality", "security"]);
    record = claim(claim(record, "quality"), "security");
    expect(() => claim(record, "quality")).toThrow(/not ready/);
    record = pass(record, "quality");
    expect(readySteps(record)).toEqual([]);
    record = pass(record, "security");
    expect(readySteps(record).map((item) => item.id)).toEqual(["join"]);
    expect(record.steps.find((item) => item.stepId === "quality")?.attempts).toHaveLength(1);
    expect(record.steps.find((item) => item.stepId === "security")?.attempts).toHaveLength(1);
    record = pass(claim(record, "join"), "join");
    expect(settleRun(record).status).toBe("succeeded");
  });

  it("joins only the selected decision branch and skips the inactive branch", () => {
    let record = run({
      steps: [step("decide"), step("left"), step("right"), step("join")],
      dependencies: [
        { from: "decide", to: "left" },
        { from: "decide", to: "right" },
        { from: "left", to: "join" },
        { from: "right", to: "join" },
      ],
      groups: [],
      joins: [{ stepId: "join", mode: "all", from: ["left", "right"] }],
      decisions: [
        {
          stepId: "decide",
          branches: [
            { outcome: "left", to: "left" },
            { outcome: "right", to: "right" },
          ],
        },
      ],
    });
    record = pass(claim(record, "decide"), "decide", "left");
    expect(record.steps.find((item) => item.stepId === "right")?.status).toBe("skipped");
    expect(readySteps(record).map((item) => item.id)).toEqual(["left"]);
    record = pass(claim(record, "left"), "left");
    expect(readySteps(record).map((item) => item.id)).toEqual(["join"]);
  });

  it("freezes the same candidate for reviewers and prevents a concurrent writer", () => {
    let record = pass(claim(run(), "build"), "build");
    record = claim(record, "quality");
    record = claim(record, "security");
    expect(
      record.steps.filter((item) => item.status === "running").map((item) => item.candidateId),
    ).toEqual(["candidate-a", "candidate-a"]);
    expect(record.steps.find((item) => item.stepId === "quality")?.inputHash).toBe(
      record.steps.find((item) => item.stepId === "security")?.inputHash,
    );
    expect(() => claim(record, "join")).toThrow(/not ready/);
    const parallel = run({
      steps: [step("a", "implementation"), step("b", "implementation")],
      dependencies: [],
      groups: [],
      joins: [],
    });
    expect(() => claim(claim(parallel, "a"), "b")).toThrow(/Conflicting workspace/);
  });

  it("returns to the repeat body once, then aborts a second rejection with history intact", () => {
    let record = run({
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
    record = pass(claim(record, "build"), "build");
    record = pass(claim(record, "review"), "review", "changes-requested");
    record = continueRepeat(record, "review");
    expect(record.implementationRound).toBe(2);
    expect(record.steps.find((item) => item.stepId === "build")?.status).toBe("pending");
    record = pass(claim(record, "build"), "build");
    record = pass(claim(record, "review"), "review", "changes-requested");
    record = continueRepeat(record, "review");
    expect(record.status).toBe("rejected");
    expect(record.steps.find((item) => item.stepId === "build")?.attempts).toHaveLength(2);
  });

  it("succeeds after one repair and keeps terminal causes distinct", () => {
    const definition = {
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
    };
    let record = pass(claim(run(definition), "build"), "build");
    record = pass(claim(record, "review"), "review", "changes-requested");
    record = continueRepeat(record, "review");
    record = pass(claim(record, "build"), "build");
    record = pass(claim(record, "review"), "review", "pass");
    record = pass(claim(record, "done"), "done");
    expect(settleRun(record).status).toBe("succeeded");
    for (const status of ["failed", "canceled", "unavailable"] as const) {
      const outcome = completeStep(claim(run(), "build"), "build", { status });
      expect(outcome.status).toBe(status);
      expect(readySteps(outcome)).toEqual([]);
    }
  });

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

const reviewerIds = ["r1", "r2", "r3", "r4", "r5", "r6"];
const blockedLoop = (input: Record<string, unknown> = {}) =>
  parseLoop({
    schemaVersion: 2,
    id: "reviews",
    name: "Reviews",
    version: 1,
    status: "published",
    steps: [
      step("build", "implementation"),
      ...reviewerIds.map((id) => step(id, "review", "panel")),
      { ...step("adjudicate", "implementation"), name: "Adjudicate" },
    ],
    dependencies: [
      ...reviewerIds.map((id) => ({ from: "build", to: id })),
      ...reviewerIds.map((id) => ({ from: id, to: "adjudicate" })),
    ],
    groups: [{ id: "panel", name: "Panel", kind: "parallel", stepIds: reviewerIds }],
    joins: [{ stepId: "adjudicate", mode: "all", from: reviewerIds }],
    decisions: [],
    policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 1 },
    ...input,
  });
const legacyRun = async (root: string, loop = blockedLoop(), provider = "mock") => {
  await mkdir(join(root, ".code-factory", "workspaces", "candidate"), { recursive: true });
  const record = createRunRecord(
    createRunSnapshot(
      loop,
      { description: "Task" },
      { provider: provider as "mock", model: "default" },
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

describe("blocked review recovery", () => {
  it("holds adjudication behind a blocked reviewer, then runs it after that reviewer is retried", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-blocked-"));
    try {
      const record = await legacyRun(root);
      const outputs: Record<string, string[]> = {
        build: ["built"],
        adjudicate: ["adjudicated"],
        ...Object.fromEntries(reviewerIds.slice(0, 5).map((id) => [id, ["pass"]])),
        r6: ["blocked\nCannot run yarn test: shell refused.", "pass"],
      };
      const seen: ScriptedInstructions = {};
      const blocked = await executeRun(root, record.snapshot.id, () =>
        scriptedAdapter(outputs, seen),
      );
      expect(blocked.status).toBe("blocked");
      expect(readySteps(blocked)).toEqual([]);
      expect(blocked.steps.find((item) => item.stepId === "adjudicate")?.status).toBe("pending");
      const attempt = blocked.steps.find((item) => item.stepId === "r6")?.attempts.at(-1);
      if (!attempt) throw new Error("Missing reviewer attempt");
      expect(retryBlocker(blocked, "r6")).toBeNull();
      expect(retryBlocker(blocked, "r1")).toBe(
        "Only a failed step in a failed run can be retried.",
      );
      const retried = await retryStep(root, record.snapshot.id, "r6", attempt.id, () =>
        scriptedAdapter(outputs, seen),
      );
      expect(retried.status).toBe("succeeded");
      expect(retried.steps.find((item) => item.stepId === "adjudicate")?.status).toBe("succeeded");
      expect(
        retried.evidence.some(
          (item) => item.kind === "event" && item.title === "selected-step-retry",
        ),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the run blocked while another reviewer still holds a blocked verdict, and respects the budget", () => {
    let record = createRunRecord(
      createRunSnapshot(
        blockedLoop(),
        { description: "Task" },
        { provider: "mock", model: "default" },
      ),
    );
    record = pass(claim(record, "build"), "build");
    for (const id of reviewerIds) record = claim(record, id);
    for (const id of reviewerIds)
      record = pass(record, id, id === "r5" || id === "r6" ? "blocked" : "pass");
    expect(record.status).toBe("blocked");
    const retryReviewer = (current: RunRecord, id: string, outcome: string) => {
      const attemptId = current.steps.find((item) => item.stepId === id)?.attempts.at(-1)?.id ?? "";
      return pass(claim(prepareStepRetry(current, id, attemptId), id), id, outcome);
    };
    record = retryReviewer(record, "r5", "pass");
    expect(record.status).toBe("blocked");
    expect(readySteps(record)).toEqual([]);
    expect(record.steps.find((item) => item.stepId === "adjudicate")?.status).toBe("pending");
    expect(retryBlocker(record, "r6")).toBeNull();
    record = retryReviewer(record, "r6", "blocked");
    expect(retryBlocker(record, "r6")).toBe("Attempt limit reached for this step.");
    expect(() =>
      prepareStepRetry(
        record,
        "r6",
        record.steps.find((item) => item.stepId === "r6")?.attempts.at(-1)?.id ?? "",
      ),
    ).toThrow("Attempt limit reached for this step.");
  });

  it("allows a second blocker's retry to release adjudication", () => {
    let record = createRunRecord(
      createRunSnapshot(
        blockedLoop(),
        { description: "Task" },
        { provider: "mock", model: "default" },
      ),
    );
    record = pass(claim(record, "build"), "build");
    for (const id of reviewerIds) record = claim(record, id);
    for (const id of reviewerIds)
      record = pass(record, id, id === "r5" || id === "r6" ? "blocked" : "pass");
    for (const id of ["r5", "r6"]) {
      const attemptId = record.steps.find((item) => item.stepId === id)?.attempts.at(-1)?.id ?? "";
      record = pass(claim(prepareStepRetry(record, id, attemptId), id), id, "pass");
    }
    expect(record.status).toBe("running");
    expect(readySteps(record).map((item) => item.id)).toEqual(["adjudicate"]);
  });
});

describe("agent tool permission per attempt", () => {
  const recording = (inputs: StepExecutionInput[]) => ({
    ...mockAdapter,
    provider: "kiro" as const,
    async *execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent> {
      inputs.push(input);
      yield* mockAdapter.execute(input, signal);
    },
  });
  const singleStep = parseLoop({
    schemaVersion: 2,
    id: "single",
    name: "Single",
    version: 1,
    status: "published",
    steps: [step("build", "implementation")],
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
    policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 1 },
  });
  const permissionEvent = (run: RunRecord) =>
    run.evidence
      .filter((item) => item.kind === "event" && item.title === "Tool permission")
      .map((item) => (item.kind === "event" ? item.detail : ""));

  it("uses the default without a grant, applies a stored grant, and returns to the default after revoke", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-grant-"));
    try {
      await initializeProject(root);
      const inputs: StepExecutionInput[] = [];
      const first = await legacyRun(root, singleStep, "kiro");
      const defaulted = await executeRun(root, first.snapshot.id, () => recording(inputs));
      expect(inputs[0]?.toolGrant).toBeUndefined();
      expect(permissionEvent(defaulted)).toEqual([
        "Kiro default: trusted tools fs_read, fs_write. Shell (execute_bash) is not trusted.",
      ]);
      await trustProject(root);
      await grantToolPermission(root, "kiro", new Date("2026-10-07T10:00:00.000Z"));
      const second = await legacyRun(root, singleStep, "kiro");
      const granted = await executeRun(root, second.snapshot.id, () => recording(inputs));
      expect(inputs[1]?.toolGrant).toEqual({
        provider: "kiro",
        scope: ["execute_bash"],
        grantedAt: "2026-10-07T10:00:00.000Z",
      });
      expect(permissionEvent(granted)).toEqual([
        "Kiro project grant from 2026-10-07T10:00:00.000Z: trusted tools fs_read, fs_write, execute_bash.",
      ]);
      await revokeToolPermission(root, "kiro");
      const third = await legacyRun(root, singleStep, "kiro");
      await executeRun(root, third.snapshot.id, () => recording(inputs));
      expect(inputs[2]?.toolGrant).toBeUndefined();
      // A grant in the project's own file is ignored: only the user's trust store grants tools.
      const config = join(root, ".code-factory", "project.json");
      const saved = JSON.parse(await readFile(config, "utf8")) as Record<string, unknown>;
      await writeFile(
        config,
        JSON.stringify({
          ...saved,
          toolGrants: { kiro: { scope: ["execute_bash"], grantedAt: "2026-10-07T10:00:00.000Z" } },
        }),
      );
      const fourth = await legacyRun(root, singleStep, "kiro");
      await executeRun(root, fourth.snapshot.id, () => recording(inputs));
      expect(inputs[3]?.toolGrant).toBeUndefined();
      await writeFile(join(trustDirectory(), "trust.json"), "{ not json");
      const fifth = await legacyRun(root, singleStep, "kiro");
      const broken = await executeRun(root, fifth.snapshot.id, () => recording(inputs));
      expect(inputs[4]?.toolGrant).toBeUndefined();
      expect(permissionEvent(broken)[0]).toMatch(
        /^Kiro default: .* Tool permission unavailable: Invalid trust file/,
      );
    } finally {
      await rm(join(trustDirectory(), "trust.json"), { force: true });
      await rm(root, { recursive: true, force: true });
    }
  });
});
