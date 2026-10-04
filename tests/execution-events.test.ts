import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import {
  attachAttemptSession,
  createRunRecord,
  createRunSnapshot,
  finishAttempt,
  runRecordSchema,
  startAttempt,
  type RunRecord,
} from "../src/domain/run.js";
import { claimStep } from "../src/domain/scheduler.js";
import { mockAdapter } from "../src/adapters/mock.js";
import { executeRun } from "../src/runtime/scheduler.js";
import { eventsAfter, parseEventCursor } from "../src/runtime/events.js";
import { createRun, readRun, updateRun } from "../src/runtime/storage.js";
import { startLocalServer } from "../src/runtime/server.js";
import { ConnectionRegistry } from "../src/runtime/connections.js";
import { mergeRunEvent, mergeRunSnapshot } from "../src/ui/run-events.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const fixture = async (): Promise<{ root: string; record: RunRecord }> => {
  const root = await mkdtemp(join(tmpdir(), "factory-events-"));
  roots.push(root);
  const workspace = join(root, ".code-factory", "workspaces", "candidate");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "task.txt"), "baseline");
  const loop = parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 1,
    status: "published",
    steps: [
      {
        id: "build",
        name: "Build",
        kind: "agent",
        stage: "implementation",
        role: "builder",
        instruction: "Build",
      },
    ],
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
    policy: { maxAttemptsPerStep: 2 },
  });
  const record = createRunRecord(
    createRunSnapshot(
      loop,
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
  return { root, record };
};

it("replays committed events after a cursor and deduplicates out-of-order delivery", async () => {
  const { root, record } = await fixture();
  const finished = await executeRun(root, record.snapshot.id, () => mockAdapter);
  const events = eventsAfter(finished, -1);
  expect(events.map((item) => item.sequence)).toEqual([0, 1, 2]);
  expect(eventsAfter(finished, 0).map((item) => item.sequence)).toEqual([1, 2]);
  expect(eventsAfter((await readRun(root, record.snapshot.id)) as RunRecord, 2)).toEqual([]);
  expect(() =>
    runRecordSchema.parse({
      ...finished,
      evidence: finished.evidence.map((item) =>
        item.kind === "event" && item.sequence === 2 ? { ...item, sequence: 4 } : item,
      ),
    }),
  ).toThrow(/contiguous/);
  expect(() => parseEventCursor("1.5")).toThrow(/cursor/);
  let client = record;
  client = mergeRunEvent(client, events[2]!);
  client = mergeRunEvent(client, events[0]!);
  client = mergeRunEvent(client, events[1]!);
  client = mergeRunEvent(client, events[1]!);
  expect(
    client.evidence.filter((item) => item.kind === "event").map((item) => item.sequence),
  ).toEqual([0, 1, 2]);
  expect(
    mergeRunSnapshot(client, finished).evidence.filter((item) => item.kind === "event"),
  ).toHaveLength(3);
});

it("reconnects to active work after a closed browser stream without canceling the attempt", async () => {
  const { root, record } = await fixture();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const adapter = {
    ...mockAdapter,
    async *execute(input: Parameters<typeof mockAdapter.execute>[0], signal: AbortSignal) {
      const session = {
        runId: input.runId,
        stepId: input.stepId,
        attempt: input.attempt,
        sessionId: "session",
        turnId: "turn",
      };
      yield { type: "started" as const, ...session };
      yield { type: "message" as const, text: "working", ...session };
      await gate;
      signal.throwIfAborted();
      yield {
        type: "completed" as const,
        outcome: "succeeded" as const,
        output: "done",
        ...session,
      };
    },
  };
  class TestConnections extends ConnectionRegistry {
    override adapter(provider: string) {
      return provider === "mock" ? adapter : null;
    }
  }
  const { server, url } = await startLocalServer({
    projectDirectory: root,
    port: 0,
    connections: new TestConnections(root),
  });
  try {
    const launch = await fetch(`${url}/api/runs/${record.snapshot.id}/execute`, { method: "POST" });
    expect(launch.status).toBe(202);
    await vi.waitFor(async () =>
      expect(eventsAfter((await readRun(root, record.snapshot.id))!, -1)).toHaveLength(2),
    );
    const controller = new AbortController();
    const first = await fetch(`${url}/api/runs/${record.snapshot.id}/events`, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    expect(first.status).toBe(200);
    const chunk = await first.body!.getReader().read();
    expect(new TextDecoder().decode(chunk.value)).toContain("event: execution-event");
    controller.abort();
    expect((await readRun(root, record.snapshot.id))?.status).toBe("running");
    release?.();
    await vi.waitFor(async () =>
      expect((await readRun(root, record.snapshot.id))?.status).toBe("succeeded"),
    );
    const replay = await fetch(`${url}/api/runs/${record.snapshot.id}/events?cursor=1`).then(
      (response) => response.json(),
    );
    expect(replay.events.map((item: { sequence: number }) => item.sequence)).toEqual([2]);
    expect(replay.status).toBe("succeeded");
    const resumed = await fetch(`${url}/api/runs/${record.snapshot.id}/events`, {
      headers: { Accept: "text/event-stream", "Last-Event-ID": "1" },
    });
    const resumedReader = resumed.body!.getReader();
    const resumedText = new TextDecoder().decode((await resumedReader.read()).value);
    expect(resumedText).toContain("id: 2\n");
    expect(resumedText).not.toContain("id: 1\n");
    await resumedReader.cancel();
  } finally {
    release?.();
    server.close();
  }
});

it("recovers only a verified active session and never starts another paid attempt", async () => {
  const { root, record } = await fixture();
  const claimed = claimStep(record, "build", "candidate", "input");
  await updateRun(root, claimed);
  const attached = attachAttemptSession(claimed, "build", "session", "turn");
  await updateRun(root, attached);
  let launches = 0;
  let attaches = 0;
  const adapter = {
    ...mockAdapter,
    capabilities: {
      streaming: "supported" as const,
      steering: "unsupported" as const,
      resume: "supported" as const,
    },
    async *execute() {
      launches++;
      yield* [];
    },
    async *attach(session: Parameters<typeof mockAdapter.attach>[0]) {
      attaches++;
      yield {
        type: "completed" as const,
        outcome: "succeeded" as const,
        output: "recovered",
        ...session,
      };
    },
  };
  const finished = await executeRun(root, record.snapshot.id, () => adapter);
  expect({ launches, attaches }).toEqual({ launches: 0, attaches: 1 });
  expect(finished.status).toBe("succeeded");
  expect(finished.steps[0]?.attempts).toHaveLength(1);
  expect(finished.steps[0]?.attempts[0]?.sessionId).toBe("session");
});

it("records unknown recovery explicitly and preserves attempts and queued guidance", async () => {
  const { root, record } = await fixture();
  const claimed = claimStep(record, "build", "candidate", "input");
  await updateRun(root, claimed);
  const prior = finishAttempt(claimed, "build", "failed");
  await updateRun(root, prior);
  const retry = startAttempt(prior, "build");
  await updateRun(root, retry);
  const attached = attachAttemptSession(retry, "build", "session", "turn");
  await updateRun(root, attached);
  const queued = {
    ...attached,
    revision: attached.revision + 1,
    evidence: [
      ...attached.evidence,
      {
        id: crypto.randomUUID(),
        runId: record.snapshot.id,
        stepId: "build",
        attemptId: attached.steps[0]!.attempts[0]!.id,
        createdAt: new Date().toISOString(),
        kind: "guidance" as const,
        messageId: crypto.randomUUID(),
        message: "Keep the existing files",
        state: "queued" as const,
      },
    ],
  };
  await updateRun(root, queued);
  const result = await executeRun(root, record.snapshot.id, () => mockAdapter);
  expect(result.status).toBe("unavailable");
  expect(result.steps[0]?.attempts.map((item) => item.status)).toEqual(["failed", "interrupted"]);
  expect(result.evidence.find((item) => item.kind === "guidance")).toMatchObject({
    message: "Keep the existing files",
    state: "queued",
  });
  expect(result.evidence.find((item) => item.kind === "event")).toMatchObject({
    title: "recovery-unavailable",
    state: "unknown",
  });
});

it("reconstructs an interrupted run when the service starts without relaunching mock work", async () => {
  const { root, record } = await fixture();
  const claimed = claimStep(record, "build", "candidate", "input");
  await updateRun(root, claimed);
  const attached = attachAttemptSession(claimed, "build", "session", "turn");
  await updateRun(root, attached);
  const { server } = await startLocalServer({ projectDirectory: root, port: 0 });
  try {
    await vi.waitFor(async () => {
      const reconstructed = await readRun(root, record.snapshot.id);
      expect(reconstructed?.status).toBe("unavailable");
      expect(reconstructed?.steps[0]?.attempts[0]?.status).toBe("interrupted");
    });
    expect((await readRun(root, record.snapshot.id))?.steps[0]?.attempts).toHaveLength(1);
  } finally {
    server.close();
  }
});

it("keeps a lost adapter transport unknown instead of reporting a failed provider turn", async () => {
  const { root, record } = await fixture();
  const adapter = {
    ...mockAdapter,
    async *execute(input: Parameters<typeof mockAdapter.execute>[0]) {
      yield {
        type: "started" as const,
        runId: input.runId,
        stepId: input.stepId,
        attempt: input.attempt,
        sessionId: "session",
        turnId: "turn",
      };
      throw new Error("Transport closed");
    },
  };
  const result = await executeRun(root, record.snapshot.id, () => adapter);
  expect(result.status).toBe("unavailable");
  expect(result.steps[0]?.attempts[0]?.status).toBe("interrupted");
  expect(
    result.evidence.find((item) => item.kind === "event" && item.title === "execution-interrupted"),
  ).toMatchObject({ detail: "Transport closed", state: "unknown" });
  expect(result.evidence.some((item) => item.kind === "event" && item.title === "completed")).toBe(
    false,
  );
});
