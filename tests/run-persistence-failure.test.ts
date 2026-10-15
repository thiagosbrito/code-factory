import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { mockAdapter } from "../src/adapters/mock.js";
import type { AdapterEvent } from "../src/adapters/contract.js";
import { createRun, mutateRun, readRun } from "../src/runtime/storage.js";
import { cancelRun, executeRun, isRunActive, runExecutionError } from "../src/runtime/scheduler.js";
import { runRecordSchema } from "../src/domain/run.js";
import { run, step } from "./support/scheduler.js";
import { startLocalServer } from "../src/runtime/server.js";
import { runResponseSchema } from "../src/ui/shared/project-api.js";

const { replace } = vi.hoisted(() => ({
  replace: vi.fn<typeof import("../src/runtime/storage-replace.js").replaceStorageFile>(),
}));
vi.mock("../src/runtime/storage-replace.js", () => ({ replaceStorageFile: replace }));
let root = "";
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it("persists interruption after a failed completion write and can cancel without rerunning", async () => {
  const actual = await vi.importActual<typeof import("../src/runtime/storage-replace.js")>(
    "../src/runtime/storage-replace.js",
  );
  replace.mockReset().mockImplementation(actual.replaceStorageFile);
  root = await mkdtemp(join(tmpdir(), "factory-completion-write-"));
  await mkdir(join(root, ".code-factory", "workspaces", "candidate"), { recursive: true });
  const seed = run({
    steps: [step("build", "implementation")],
    dependencies: [],
    groups: [],
    joins: [],
  });
  const initial = {
    ...seed,
    snapshot: {
      ...seed.snapshot,
      baseline: { ...seed.snapshot.baseline, workspace: ".code-factory/workspaces/candidate" },
    },
  };
  await createRun(root, initial);
  const failure = Object.assign(new Error("EPERM: completion could not be saved"), {
    code: "EPERM",
  });
  const adapter = {
    ...mockAdapter,
    async *execute(input: Parameters<typeof mockAdapter.execute>[0]): AsyncIterable<AdapterEvent> {
      const identity = {
        runId: input.runId,
        stepId: input.stepId,
        attempt: input.attempt,
        sessionId: crypto.randomUUID(),
        turnId: crypto.randomUUID(),
      };
      yield { type: "started", ...identity };
      const attemptId = (await readRun(root, input.runId))?.steps[0]?.attempts[0]?.id;
      await mutateRun(root, input.runId, (current) =>
        runRecordSchema.parse({
          ...current,
          revision: current.revision + 1,
          evidence: [
            ...current.evidence,
            {
              kind: "guidance",
              id: crypto.randomUUID(),
              runId: current.snapshot.id,
              createdAt: new Date().toISOString(),
              stepId: "build",
              attemptId,
              messageId: crypto.randomUUID(),
              message: "steer",
              state: "queued",
            },
          ],
        }),
      );
      replace.mockRejectedValueOnce(failure);
      yield { type: "completed", ...identity, outcome: "succeeded", output: "Done" };
    },
  };
  const interrupted = await executeRun(root, initial.snapshot.id, () => adapter);
  expect(interrupted.status).toBe("unavailable");
  expect(interrupted.steps[0]?.attempts[0]?.status).toBe("interrupted");
  expect(
    interrupted.evidence.find((item) => "title" in item && item.title === "execution-interrupted"),
  ).toMatchObject({
    detail: failure.message,
  });
  expect(await readRun(root, initial.snapshot.id)).toEqual(interrupted);
  // Append-only: the queued guidance is superseded by a rejected entry once persistence recovers.
  expect(
    interrupted.evidence.some((item) => item.kind === "guidance" && item.state === "rejected"),
  ).toBe(true);
  expect(
    (await readdir(join(root, ".code-factory", "runs"))).filter(
      (name) => name.endsWith(".tmp") || name.endsWith(".lock"),
    ),
  ).toEqual([]);
  const canceled = await cancelRun(root, initial.snapshot.id);
  expect(canceled.status).toBe("canceled");
  expect(canceled.steps).toEqual(interrupted.steps);
  expect(canceled.evidence.slice(0, interrupted.evidence.length)).toEqual(interrupted.evidence);
  expect(runExecutionError(root, initial.snapshot.id)).toBeUndefined();
});

it("aborts siblings and holds ownership until they settle after persistence is exhausted", async () => {
  const actual = await vi.importActual<typeof import("../src/runtime/storage-replace.js")>(
    "../src/runtime/storage-replace.js",
  );
  replace.mockImplementation(actual.replaceStorageFile);
  root = await mkdtemp(join(tmpdir(), "factory-persistence-"));
  const workspace = join(root, ".code-factory", "workspaces", "candidate");
  await mkdir(workspace, { recursive: true });
  const seed = run({
    steps: [step("one", "review", "panel"), step("two", "review", "panel")],
    dependencies: [],
    groups: [{ id: "panel", name: "Panel", kind: "parallel", stepIds: ["one", "two"] }],
    joins: [],
  });
  const initial = {
    ...seed,
    snapshot: {
      ...seed.snapshot,
      baseline: { ...seed.snapshot.baseline, workspace: ".code-factory/workspaces/candidate" },
    },
  };
  await createRun(root, initial);
  let bothStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    bothStarted = resolve;
  });
  let failWrite: () => void = () => undefined;
  const failureReady = new Promise<void>((resolve) => {
    failWrite = resolve;
  });
  let finishSibling: () => void = () => undefined;
  const siblingCleanup = new Promise<void>((resolve) => {
    finishSibling = resolve;
  });
  let observedAbort: () => void = () => undefined;
  const aborted = new Promise<void>((resolve) => {
    observedAbort = resolve;
  });
  const adapter = {
    ...mockAdapter,
    async *execute(
      input: Parameters<typeof mockAdapter.execute>[0],
      signal: AbortSignal,
    ): AsyncIterable<AdapterEvent> {
      if (input.stepId === "one") {
        await failureReady;
        yield {
          type: "started",
          runId: input.runId,
          stepId: input.stepId,
          attempt: input.attempt,
          sessionId: crypto.randomUUID(),
          turnId: crypto.randomUUID(),
        };
      } else {
        bothStarted();
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              observedAbort();
              resolve();
            },
            { once: true },
          ),
        );
        await siblingCleanup;
        signal.throwIfAborted();
      }
    },
  };
  const work = executeRun(root, initial.snapshot.id, () => adapter).catch(
    (error: unknown) => error,
  );
  await started;
  const failure = Object.assign(new Error("EPERM: run file is locked"), { code: "EPERM" });
  replace.mockRejectedValue(failure);
  failWrite();
  try {
    await Promise.race([
      aborted,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Sibling was not aborted")), 1000),
      ),
    ]);
    expect(isRunActive(root, initial.snapshot.id)).toBe(true);
    expect(
      await readdir(join(root, ".code-factory", "execution-owners", initial.snapshot.id)),
    ).toHaveLength(1);
  } finally {
    finishSibling();
    await work;
  }
  expect(await work).toBe(failure);
  expect(isRunActive(root, initial.snapshot.id)).toBe(false);
  expect(runExecutionError(root, initial.snapshot.id)).toBe(failure.message);
  expect(
    await readdir(join(root, ".code-factory", "execution-owners", initial.snapshot.id)),
  ).toHaveLength(0);
  expect(
    (await readRun(root, initial.snapshot.id))?.steps.every((item) => item.status === "running"),
  ).toBe(true);
  const durable = await readRun(root, initial.snapshot.id);
  const { server, url } = await startLocalServer({
    projectDirectory: root,
    port: 0,
    sessionToken: null,
  });
  try {
    const response = await fetch(`${url}/api/runs/${initial.snapshot.id}`);
    expect(response.status).toBe(200);
    expect(runResponseSchema.parse(await response.json())).toMatchObject({
      run: durable,
      interrupted: true,
      executionError: failure.message,
    });
    const blocked = await fetch(`${url}/api/runs/${initial.snapshot.id}/cancel`, {
      method: "POST",
    });
    expect(blocked.status).toBe(500);
    expect(await readRun(root, initial.snapshot.id)).toEqual(durable);
    replace.mockImplementation(actual.replaceStorageFile);
    const recovered = await fetch(`${url}/api/runs/${initial.snapshot.id}/cancel`, {
      method: "POST",
    });
    expect(recovered.status).toBe(200);
    const canceled = runResponseSchema.parse(await recovered.json()).run;
    expect(canceled.status).toBe("canceled");
    expect(canceled.snapshot).toEqual(durable?.snapshot);
    expect(canceled.evidence.slice(0, durable?.evidence.length)).toEqual(durable?.evidence);
    expect(runExecutionError(root, initial.snapshot.id)).toBeUndefined();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("treats a stale run lock as a persistence failure that is reported and aborts the run", async () => {
  const actual = await vi.importActual<typeof import("../src/runtime/storage-replace.js")>(
    "../src/runtime/storage-replace.js",
  );
  replace.mockReset().mockImplementation(actual.replaceStorageFile);
  root = await mkdtemp(join(tmpdir(), "factory-stale-lock-"));
  await mkdir(join(root, ".code-factory", "workspaces", "candidate"), { recursive: true });
  const seed = run({
    steps: [step("build", "implementation")],
    dependencies: [],
    groups: [],
    joins: [],
  });
  const initial = {
    ...seed,
    snapshot: {
      ...seed.snapshot,
      baseline: { ...seed.snapshot.baseline, workspace: ".code-factory/workspaces/candidate" },
    },
  };
  await createRun(root, initial);
  // A crash left the lock directory behind, so every later write fails with EEXIST.
  await mkdir(join(root, ".code-factory", "runs", `${initial.snapshot.id}.json.lock`));
  const outcome = await executeRun(root, initial.snapshot.id, () => mockAdapter).catch(
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(Error);
  expect(runExecutionError(root, initial.snapshot.id)).toContain("EEXIST");
});
