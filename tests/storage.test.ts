import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLoopDraft, parseLoop } from "../src/domain/loop.js";
import {
  advanceImplementationRound,
  attachAttemptSession,
  createRunRecord,
  createRunSnapshot,
  finishAttempt,
  migrateRun,
  runRecordSchema,
  runSnapshotSchema,
  startAttempt,
} from "../src/domain/run.js";
import { checkReceiptSchema, projectRelativePathSchema } from "../src/domain/evidence.js";
import {
  createRun,
  createRunFromPublished,
  listPublishedVersions,
  publishDraft,
  readDraft,
  readPublishedVersion,
  readRun,
  saveDraft,
  updateRun,
} from "../src/runtime/storage.js";

const directories: string[] = [];
async function project() {
  const directory = await mkdtemp(join(tmpdir(), "code-factory-storage-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
function draft() {
  return parseLoop({
    ...createLoopDraft("portable", "Portable"),
    steps: [
      {
        id: "implement",
        name: "Implement",
        kind: "agent",
        role: "builder",
        instruction: "Build",
        position: { x: 10, y: 10 },
      },
      {
        id: "quality",
        name: "Quality",
        kind: "agent",
        role: "reviewer",
        instruction: "Review",
        groupId: "reviewers",
      },
      {
        id: "security",
        name: "Security",
        kind: "agent",
        role: "reviewer",
        instruction: "Review",
        groupId: "reviewers",
        binding: { provider: "codex", model: "review-model" },
      },
      { id: "join", name: "Join", kind: "check", role: "adjudicator", instruction: "Adjudicate" },
    ],
    dependencies: [
      { from: "implement", to: "quality" },
      { from: "implement", to: "security" },
      { from: "quality", to: "join" },
      { from: "security", to: "join" },
    ],
    joins: [{ stepId: "join", mode: "all", from: ["quality", "security"] }],
    groups: [
      { id: "reviewers", name: "Reviewers", kind: "parallel", stepIds: ["quality", "security"] },
    ],
  });
}

describe("durable loop publication", () => {
  it("publishes immutable numbered copies, advances drafts, and reloads after edits", async () => {
    const root = await project();
    const first = draft();
    await saveDraft(root, first);
    const published = await publishDraft(root, "portable");
    expect(published.version).toBe(1);
    expect((await readDraft(root, "portable"))?.version).toBe(2);
    const next = (await readDraft(root, "portable"))!;
    next.name = "Portable v2";
    await saveDraft(root, next);
    await publishDraft(root, "portable");
    expect(await listPublishedVersions(root, "portable")).toEqual([1, 2]);
    expect((await readPublishedVersion(root, "portable", 1))?.name).toBe("Portable");
    expect((await readPublishedVersion(root, "portable", 2))?.name).toBe("Portable v2");
    const run = await createRunFromPublished(
      root,
      "portable",
      1,
      { description: "Selected version" },
      { provider: "mock", model: "default" },
      { id: "base", kind: "unversioned", capturedAt: new Date().toISOString() },
    );
    expect(run.snapshot.loop.name).toBe("Portable");
    expect((await readRun(root, run.snapshot.id))?.snapshot.loop.version).toBe(1);
    await expect(saveDraft(root, { ...published, status: "draft" })).rejects.toThrow(
      /future version 3/,
    );
    expect(
      await readFile(
        join(root, ".code-factory", "loops", "portable", "versions", "1.json"),
        "utf8",
      ),
    ).toContain('"status": "published"');
  });
  it("reports invalid imports and corrupt files without replacing saved definitions", async () => {
    const root = await project();
    const first = draft();
    await saveDraft(root, first);
    await expect(
      saveDraft(root, { ...first, dependencies: [{ from: "missing", to: "join" }] }),
    ).rejects.toThrow(/existing steps/);
    expect((await readDraft(root, "portable"))?.dependencies).toEqual(first.dependencies);
    const path = join(root, ".code-factory", "loops", "portable", "draft.json");
    await writeFile(path, "{bad");
    await expect(readDraft(root, "portable")).rejects.toThrow(/Invalid JSON.*draft.json/);
    await expect(saveDraft(root, first)).rejects.toThrow(/Invalid JSON.*draft.json/);
    expect(await readFile(path, "utf8")).toBe("{bad");
    await expect(publishDraft(root, "portable")).rejects.toThrow(/Invalid JSON/);
    await writeFile(path, "null");
    await expect(saveDraft(root, first)).rejects.toThrow(/Invalid.*draft.json/);
    expect(await readFile(path, "utf8")).toBe("null");
  });
});

describe("graph and migration contracts", () => {
  it("rejects invalid joins, groups, decisions, cycles, and unbounded repeats", () => {
    const base = draft();
    expect(() =>
      parseLoop({
        ...base,
        steps: base.steps.map((step) =>
          step.id === "quality" ? { ...step, groupId: undefined } : step,
        ),
      }),
    ).toThrow(/containing group/);
    const valid = base;
    expect(() =>
      parseLoop({
        ...valid,
        joins: [{ stepId: "join", mode: "all", from: ["quality", "missing"] }],
      }),
    ).toThrow(/needs dependency/);
    expect(() =>
      parseLoop({
        ...valid,
        dependencies: [...valid.dependencies, { from: "join", to: "implement" }],
      }),
    ).toThrow(/cycles/);
    expect(() =>
      parseLoop({
        ...valid,
        groups: [
          ...valid.groups,
          { id: "repeat", name: "Repeat", kind: "repeat", stepIds: ["implement"] },
        ],
      }),
    ).toThrow(/maxIterations/);
    expect(() =>
      parseLoop({
        ...valid,
        decisions: [
          {
            stepId: "implement",
            branches: [
              { outcome: "yes", to: "quality" },
              { outcome: "no", to: "missing" },
            ],
          },
        ],
      }),
    ).toThrow(/needs dependency/);
    const moved = parseLoop({
      ...valid,
      steps: valid.steps.map((step) => ({ ...step, position: { x: -100, y: 400 } })),
    });
    expect(moved.dependencies).toEqual(valid.dependencies);
    const repeat = parseLoop({
      ...createLoopDraft("bounded", "Bounded"),
      steps: [
        {
          id: "build",
          name: "Build",
          kind: "agent",
          role: "builder",
          instruction: "Build",
          groupId: "repair",
        },
        {
          id: "verify",
          name: "Verify",
          kind: "check",
          role: "verifier",
          instruction: "Verify",
          groupId: "repair",
        },
        { id: "done", name: "Done", kind: "check", role: "reporter", instruction: "Report" },
      ],
      dependencies: [
        { from: "build", to: "verify" },
        { from: "verify", to: "done" },
      ],
      groups: [
        {
          id: "repair",
          name: "Repair",
          kind: "repeat",
          stepIds: ["build", "verify"],
          maxIterations: 2,
          exitWhen: { stepId: "verify", outcome: "pass" },
          continueWhen: { outcome: "repair", to: "build" },
        },
      ],
      decisions: [
        {
          stepId: "verify",
          branches: [
            { outcome: "pass", to: "done" },
            { outcome: "repair", to: "build" },
          ],
        },
      ],
    });
    expect(repeat.groups[0]?.kind).toBe("repeat");
    expect(() =>
      parseLoop({ ...repeat, groups: [{ ...repeat.groups[0], maxIterations: 0 }] }),
    ).toThrow(/maxIterations/);
    expect(() =>
      parseLoop({
        ...repeat,
        dependencies: [...repeat.dependencies, { from: "verify", to: "build" }],
      }),
    ).toThrow(/cycles/);
  });
  it("migrates V1 loops and detached run snapshots into V2", async () => {
    const oldLoop = { ...createLoopDraft("legacy", "Legacy"), schemaVersion: 1 };
    const { groups: _groups, joins: _joins, decisions: _decisions, ...v1 } = oldLoop;
    const migrated = parseLoop(v1);
    expect(migrated).toMatchObject({ schemaVersion: 2, groups: [], joins: [], decisions: [] });
    const published = parseLoop({
      ...migrated,
      status: "published",
      steps: [{ id: "build", name: "Build", kind: "agent", role: "builder", instruction: "Build" }],
    });
    const snapshot = createRunSnapshot(
      published,
      { description: "Legacy task" },
      { provider: "mock", model: "default" },
    );
    const {
      baseline: _baseline,
      projectDefault: _default,
      schemaVersion: _schemaVersion,
      ...withoutNew
    } = snapshot;
    const oldRun = {
      ...withoutNew,
      loop: { ...v1, status: "published", steps: published.steps },
    };
    expect(runSnapshotSchema.parse(migrateRun(oldRun))).toMatchObject({
      schemaVersion: 2,
      baseline: { kind: "unversioned" },
      loop: { schemaVersion: 2 },
    });
    const root = await project();
    const path = join(root, ".code-factory", "loops", "legacy", "draft.json");
    await mkdir(join(root, ".code-factory", "loops", "legacy"), { recursive: true });
    await writeFile(path, JSON.stringify(v1));
    expect((await readDraft(root, "legacy"))?.schemaVersion).toBe(2);
  });
});

describe("durable run histories", () => {
  it("retains detached settings, task, baseline, parallel states, attempts and separate repair rounds on reload", async () => {
    const root = await project();
    const loop = draft();
    const published = parseLoop({ ...loop, status: "published" });
    const task = { description: "Original task" };
    const defaultBinding = { provider: "mock" as const, model: "first" };
    const baseline = {
      id: "baseline-1",
      kind: "git" as const,
      revision: "abc123",
      capturedAt: new Date().toISOString(),
    };
    let record = createRunRecord(createRunSnapshot(published, task, defaultBinding, baseline));
    await createRun(root, record);
    task.description = "Changed task";
    defaultBinding.model = "second";
    published.name = "Changed loop";
    record = startAttempt(record, "quality");
    await updateRun(root, record);
    expect(record.steps.find((step) => step.stepId === "security")?.status).toBe("pending");
    const firstAttemptId = record.steps.find((step) => step.stepId === "quality")!.attempts[0]!.id;
    record = attachAttemptSession(record, "quality", "thread-1", "turn-1");
    await updateRun(root, record);
    expect(
      (await readRun(root, record.snapshot.id))?.steps.find((step) => step.stepId === "quality")
        ?.attempts[0]?.turnId,
    ).toBe("turn-1");
    expect(() => attachAttemptSession(record, "quality", "thread-2", "turn-2")).toThrow(
      /unattached/,
    );
    record = finishAttempt(record, "quality", "failed");
    await updateRun(root, record);
    record = startAttempt(record, "quality");
    await updateRun(root, record);
    expect(record.implementationRound).toBe(1);
    record = finishAttempt(record, "quality", "failed");
    await updateRun(root, record);
    record = advanceImplementationRound(record);
    await updateRun(root, record);
    expect(record.implementationRound).toBe(2);
    expect(record.rounds.map((round) => round.number)).toEqual([1, 2]);
    expect(new Set(record.rounds.map((round) => round.id)).size).toBe(2);
    await expect(async () => advanceImplementationRound(record)).rejects.toThrow(/round limit/);
    const loaded = (await readRun(root, record.snapshot.id))!;
    expect(
      loaded.steps.find((step) => step.stepId === "quality")?.attempts.map((attempt) => attempt.id),
    ).toContain(firstAttemptId);
    expect(loaded.snapshot).toMatchObject({
      task: { description: "Original task" },
      loop: { name: "Portable" },
      projectDefault: { model: "first" },
      bindings: { security: { model: "review-model" } },
      baseline: { revision: "abc123" },
    });
    await expect(
      updateRun(root, {
        ...loaded,
        revision: loaded.revision + 1,
        snapshot: { ...loaded.snapshot, task: { description: "Tampered" } },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      updateRun(root, {
        ...loaded,
        revision: loaded.revision + 1,
        steps: loaded.steps.map((step) =>
          step.stepId === "quality"
            ? {
                ...step,
                attempts: step.attempts.map((attempt, index) =>
                  index === 0 ? { ...attempt, id: crypto.randomUUID() } : attempt,
                ),
              }
            : step,
        ),
      }),
    ).rejects.toThrow(/immutable/);
    await expect(updateRun(root, loaded)).rejects.toThrow(/revision conflict/);
    await expect(
      updateRun(root, {
        ...loaded,
        revision: loaded.revision + 1,
        rounds: loaded.rounds.map((round, index) =>
          index === 0 ? { ...round, id: crypto.randomUUID() } : round,
        ),
      }),
    ).rejects.toThrow(/round history is immutable/);
  });
  it("validates evidence identity, provenance and freshness", () => {
    const check = checkReceiptSchema.parse({
      id: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      stepId: "quality",
      attemptId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      kind: "check",
      command: "pnpm check",
      outcome: "passed",
      exitCode: 0,
      summary: "All checks pass",
      provenance: {
        source: "check",
        baselineId: "base",
        candidateId: "candidate",
        inputReceiptIds: [],
      },
      freshness: { state: "current", checkedAgainstCandidateId: "candidate" },
    });
    expect(check.provenance.candidateId).toBe("candidate");
    expect(() =>
      checkReceiptSchema.parse({ ...check, freshness: { state: "current", unknown: true } }),
    ).toThrow(/Unrecognized key/);
    expect(() => projectRelativePathSchema.parse("../secrets.txt")).toThrow(/project-relative/);
    expect(projectRelativePathSchema.parse("src/index.ts")).toBe("src/index.ts");
    const published = parseLoop({ ...draft(), status: "published" });
    const record = startAttempt(
      createRunRecord(
        createRunSnapshot(
          published,
          { description: "Evidence" },
          { provider: "mock", model: "default" },
        ),
      ),
      "quality",
    );
    const receipt = {
      ...check,
      runId: record.snapshot.id,
      attemptId: record.steps.find((step) => step.stepId === "quality")!.attempts[0]!.id,
      provenance: { ...check.provenance, baselineId: record.snapshot.baseline.id },
    };
    expect(() => runRecordSchema.parse({ ...record, evidence: [receipt] })).not.toThrow();
    expect(() => runRecordSchema.parse({ ...record, evidence: [receipt, receipt] })).toThrow(
      /Duplicate evidence ID/,
    );
    expect(() =>
      runRecordSchema.parse({
        ...record,
        evidence: [
          {
            ...receipt,
            provenance: { ...receipt.provenance, inputReceiptIds: [crypto.randomUUID()] },
          },
        ],
      }),
    ).toThrow(/missing or later input receipt/);
    expect(() =>
      runRecordSchema.parse({
        ...record,
        evidence: [
          { ...receipt, freshness: { state: "current", checkedAgainstCandidateId: "other" } },
        ],
      }),
    ).toThrow(/Current evidence/);
  });
});
