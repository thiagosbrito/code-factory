import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockAdapter } from "../src/adapters/mock.js";
import { executeRun, retryStep } from "../src/runtime/scheduler.js";
import { createRun, readRun, updateRun } from "../src/runtime/storage.js";
import { startLocalServer } from "../src/runtime/server.js";
import { evidenceFreshness } from "../src/ui/features/runs/run-view-model.js";
import { createRunRecord, createRunSnapshot, runRecordSchema } from "../src/domain/run.js";
import { completeStep, prepareStepRetry } from "../src/domain/scheduler.js";
import { trustProject } from "../src/runtime/trust.js";
import { claim, pass, run, step } from "./support/scheduler.js";

describe("portable scheduler", () => {
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
});
