import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acceptEvidence, summarizeEvidence } from "../src/domain/acceptance.js";
import { parseLoop } from "../src/domain/loop.js";
import {
  createRunRecord,
  createRunSnapshot,
  runRecordSchema,
  type RunRecord,
} from "../src/domain/run.js";
import { claimStep, completeStep } from "../src/domain/scheduler.js";
import { fileDigest } from "../src/runtime/scheduler.js";
import { startLocalServer } from "../src/runtime/server.js";
import { createRun as persistRun, readRun } from "../src/runtime/storage.js";

const candidate = "candidate-a";
const directories: string[] = [];
afterEach(async () =>
  Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);
const createRun = (baseline?: RunRecord["snapshot"]["baseline"]): RunRecord =>
  createRunRecord(
    createRunSnapshot(
      parseLoop({
        schemaVersion: 2,
        id: "validation",
        name: "Validation",
        version: 1,
        status: "published",
        steps: [
          {
            id: "check",
            name: "Build check",
            kind: "check",
            stage: "review",
            role: "reviewer",
            instruction: "Run pnpm check",
          },
        ],
        dependencies: [],
        groups: [],
        joins: [],
        decisions: [],
        policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 2 },
      }),
      { description: "Current task" },
      { provider: "mock", model: "default" },
      baseline,
    ),
  );

const successfulRun = (
  candidateId = candidate,
  baseline?: RunRecord["snapshot"]["baseline"],
): RunRecord => {
  let run = claimStep(createRun(baseline), "check", candidateId, "task-input-a");
  run = completeStep(run, "check", { status: "succeeded", outcome: "passed" });
  const attempt = run.steps[0]?.attempts[0];
  if (!attempt) throw new Error("Missing check attempt");
  return runRecordSchema.parse({
    ...run,
    status: "succeeded",
    revision: run.revision + 1,
    evidence: [
      {
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "check",
        attemptId: attempt.id,
        createdAt: new Date().toISOString(),
        kind: "check",
        command: "pnpm check",
        outcome: "passed",
        exitCode: 0,
        summary: "Passed",
        inputHash: "task-input-a",
        provenance: {
          source: "check",
          baselineId: run.snapshot.baseline.id,
          candidateId,
          inputReceiptIds: [],
        },
        freshness: { state: "current", checkedAgainstCandidateId: candidateId },
      },
    ],
  });
};

describe("human acceptance", () => {
  it("persists explicit acceptance only for the current workspace candidate", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-acceptance-"));
    directories.push(root);
    const relative = ".code-factory/workspaces/candidate";
    const workspace = join(root, relative);
    await mkdir(workspace, { recursive: true });
    const source = join(workspace, "source.txt");
    await writeFile(source, "original\n");
    const digest = await fileDigest(workspace);
    const baseline: RunRecord["snapshot"]["baseline"] = {
      id: crypto.randomUUID(),
      kind: "unversioned",
      workspace: relative,
      capturedAt: new Date().toISOString(),
    };
    const fixture = successfulRun(digest, baseline);
    await persistRun(root, { ...fixture, revision: 0 });
    const { server, url } = await startLocalServer({ projectDirectory: root, port: 0 });
    const endpoint = `${url}/api/runs/${fixture.snapshot.id}/evidence`;
    try {
      expect((await fetch(endpoint).then((response) => response.json())).summary).toMatchObject({
        validation: "passed",
        acceptance: "pending",
      });
      const accepted = await fetch(endpoint, { method: "POST" });
      expect(accepted.status).toBe(200);
      expect((await accepted.json()).summary.acceptance).toBe("accepted");
      expect((await readRun(root, fixture.snapshot.id))?.evidence.at(-1)?.kind).toBe("acceptance");
      await writeFile(source, "repaired\n");
      expect((await fetch(endpoint).then((response) => response.json())).summary).toMatchObject({
        validation: "incomplete",
        acceptance: "invalidated",
      });
      expect((await fetch(endpoint, { method: "POST" })).status).toBe(409);
      expect((await readRun(root, fixture.snapshot.id))?.evidence).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("requires a successful current check before explicit acceptance and preserves the receipt", () => {
    const run = successfulRun();
    expect(summarizeEvidence(run, candidate)).toMatchObject({
      validation: "passed",
      acceptance: "pending",
      gaps: [],
    });
    const accepted = acceptEvidence(run, candidate);
    expect(accepted.revision).toBe(run.revision + 1);
    expect(accepted.evidence).toHaveLength(2);
    expect(summarizeEvidence(accepted, candidate).acceptance).toBe("accepted");
    expect(acceptEvidence(accepted, candidate)).toBe(accepted);
    expect(runRecordSchema.parse(accepted)).toEqual(accepted);
  });

  it("rejects missing, incomplete, failed, or stale validation evidence", () => {
    const run = successfulRun();
    const withoutReceipt = { ...run, evidence: [] };
    expect(summarizeEvidence(withoutReceipt, candidate).requirements[0]?.state).toBe("gap");
    expect(() => acceptEvidence(withoutReceipt, candidate)).toThrow(/incomplete/);
    const wrongKind = {
      ...run,
      evidence: run.evidence.map((receipt) =>
        receipt.kind === "check"
          ? {
              ...receipt,
              kind: "review" as const,
              scope: "Check",
              verdict: "pass" as const,
              findings: [],
            }
          : receipt,
      ),
    };
    expect(summarizeEvidence(wrongKind, candidate).validation).toBe("incomplete");
    expect(summarizeEvidence(run, "candidate-b").requirements[0]?.reason).toMatch(
      /candidate changed/,
    );
    expect(() => acceptEvidence(run, "candidate-b")).toThrow(/incomplete/);
    const failed = {
      ...run,
      evidence: run.evidence.map((receipt) =>
        receipt.kind === "check" ? { ...receipt, outcome: "failed" as const } : receipt,
      ),
    };
    expect(summarizeEvidence(failed, candidate).validation).toBe("incomplete");
    const staleInput = {
      ...run,
      steps: run.steps.map((step) => ({ ...step, inputHash: "task-input-b" })),
    };
    expect(summarizeEvidence(staleInput, candidate).requirements[0]?.reason).toMatch(
      /input hash changed/,
    );
  });

  it("invalidates acceptance after a source change and after retry, retaining historical receipts", () => {
    const accepted = acceptEvidence(successfulRun(), candidate);
    const changed = summarizeEvidence(accepted, "candidate-b");
    expect(changed).toMatchObject({ validation: "incomplete", acceptance: "invalidated" });
    expect(accepted.evidence.at(-1)?.kind).toBe("acceptance");
    const retry = {
      ...accepted,
      status: "running" as const,
      steps: accepted.steps.map((step) => ({
        ...step,
        status: "running" as const,
        attempts: [
          ...step.attempts,
          {
            id: crypto.randomUUID(),
            number: 2,
            implementationRound: accepted.implementationRound,
            status: "running" as const,
            startedAt: new Date().toISOString(),
          },
        ],
      })),
    };
    expect(summarizeEvidence(retry, candidate).acceptance).toBe("invalidated");
    expect(retry.evidence).toHaveLength(accepted.evidence.length);
  });
});
