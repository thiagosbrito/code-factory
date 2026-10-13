import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { mockAdapter } from "../src/adapters/mock.js";
import { appendRunEvent } from "../src/domain/run-branch.js";
import { setAttemptControlState } from "../src/domain/run.js";
import { createRunContext } from "../src/runtime/run-context.js";
import { cancelRun, executeRun, retryStep, withIdleRunSlot } from "../src/runtime/scheduler.js";
import { startLocalServer } from "../src/runtime/server.js";
import { runResponseSchema } from "../src/ui/shared/project-api.js";
import { assertSoleProjectWriter, holdsProject } from "../src/runtime/run-branch-guard.js";
import { createRun, mutateRun, readRun } from "../src/runtime/storage.js";
import { claim, run, step } from "./support/scheduler.js";

const roots: string[] = [];
const project = async () => {
  const root = await mkdtemp(join(tmpdir(), "factory-recovery-"));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["waiting-input", "paused"] as const)(
  "reconciles an orphaned %s attempt through interruption",
  async (status) => {
    const root = await project();
    const seed = await createRun(root, run());
    const active = await mutateRun(root, seed.snapshot.id, (current) => claim(current, "build"));
    const attemptId = active.steps[0]?.attempts[0]?.id;
    if (!attemptId) throw new Error("Missing active attempt.");
    await mutateRun(root, seed.snapshot.id, (current) =>
      setAttemptControlState(current, "build", attemptId, status),
    );
    const canceled = await cancelRun(root, seed.snapshot.id);
    expect(canceled.status).toBe("canceled");
    expect(canceled.steps[0]?.attempts[0]).toMatchObject({ id: attemptId, status: "interrupted" });
  },
);

it("cancels multiple orphaned reviewers in one valid revision with contiguous evidence", async () => {
  const root = await project();
  const seed = await createRun(
    root,
    run({
      steps: [step("one", "review", "panel"), step("two", "review", "panel")],
      dependencies: [],
      groups: [{ id: "panel", name: "Panel", kind: "parallel", stepIds: ["one", "two"] }],
      joins: [],
    }),
  );
  await mutateRun(root, seed.snapshot.id, (current) => claim(current, "one"));
  const before = await mutateRun(root, seed.snapshot.id, (current) => claim(current, "two"));
  const canceled = await cancelRun(root, seed.snapshot.id);
  expect(canceled.revision).toBe(before.revision + 1);
  expect(canceled.steps.every((item) => item.attempts.at(-1)?.status === "interrupted")).toBe(true);
  expect(
    canceled.evidence.filter((item) => item.kind === "event").map((item) => item.sequence),
  ).toEqual([0, 1, 2]);
});

it("allows interruption evidence to persist after a failed queued write", async () => {
  const root = await project();
  const initial = await createRun(root, run());
  const ctx = createRunContext(
    root,
    initial.snapshot.id,
    initial,
    new AbortController().signal,
    () => mockAdapter,
  );
  const failure = new Error("EPERM: replacement blocked");
  await expect(
    ctx.commit(() => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  const recovered = await ctx.commit((current) =>
    appendRunEvent(current, "lifecycle", "Recovered write"),
  );
  expect(recovered.revision).toBe(initial.revision + 1);
  expect((await readRun(root, initial.snapshot.id))?.evidence.at(-1)).toMatchObject({
    title: "Recovered write",
  });
});

it("cancels orphaned active attempts without a provider and preserves evidence", async () => {
  const root = await project();
  const generated = run({
    steps: [step("build", "implementation")],
    dependencies: [],
    groups: [],
    joins: [],
  });
  const seed = {
    ...generated,
    snapshot: {
      ...generated.snapshot,
      baseline: { ...generated.snapshot.baseline, workspace: "." },
    },
  };
  await createRun(root, seed);
  await mutateRun(root, seed.snapshot.id, (current) => claim(current, "build"));
  const orphan = await mutateRun(root, seed.snapshot.id, (current) =>
    appendRunEvent(current, "lifecycle", "Before interruption"),
  );
  expect(holdsProject(orphan)).toBe(true);
  await expect(assertSoleProjectWriter(root)).rejects.toThrow("still running");
  const canceled = await cancelRun(root, orphan.snapshot.id);
  expect(canceled.status).toBe("canceled");
  expect(canceled.steps[0]?.attempts[0]).toMatchObject({
    id: orphan.steps[0]?.attempts[0]?.id,
    status: "interrupted",
    endedAt: expect.any(String),
  });
  expect(canceled.evidence.slice(0, orphan.evidence.length)).toEqual(orphan.evidence);
  expect(holdsProject(canceled)).toBe(false);
  await expect(assertSoleProjectWriter(root)).resolves.toBeUndefined();
  expect(await readRun(root, orphan.snapshot.id)).toEqual(canceled);
  const events = canceled.evidence.filter((item) => item.kind === "event");
  expect(events.map((item) => item.sequence)).toEqual(events.map((_, index) => index));
});

it("refuses orphan cancellation while another runtime process owns execution", async () => {
  const root = await project();
  const seed = await createRun(root, run());
  await mutateRun(root, seed.snapshot.id, (current) => claim(current, "build"));
  const owner = spawn(process.execPath, ["-e", "process.stdin.resume()"], { stdio: "pipe" });
  try {
    if (!owner.pid) throw new Error("Owner process did not start.");
    const directory = join(root, ".code-factory", "execution-owners", seed.snapshot.id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${owner.pid}-${crypto.randomUUID()}.owner`), "");
    const before = await readRun(root, seed.snapshot.id);
    await expect(cancelRun(root, seed.snapshot.id)).rejects.toThrow("another runtime");
    await expect(executeRun(root, seed.snapshot.id, () => mockAdapter)).rejects.toThrow(
      "another runtime",
    );
    await expect(
      retryStep(
        root,
        seed.snapshot.id,
        "build",
        before?.steps[0]?.attempts[0]?.id ?? "",
        () => mockAdapter,
      ),
    ).rejects.toThrow("another runtime");
    await expect(withIdleRunSlot(root, seed.snapshot.id, async () => seed)).rejects.toThrow(
      "another runtime",
    );
    expect(await readRun(root, seed.snapshot.id)).toEqual(before);
    const { server, url } = await startLocalServer({
      projectDirectory: root,
      port: 0,
      sessionToken: null,
    });
    try {
      const response = await fetch(`${url}/api/runs/${seed.snapshot.id}`);
      expect(response.status).toBe(200);
      expect(runResponseSchema.parse(await response.json()).interrupted).toBe(false);
      expect(
        (await fetch(`${url}/api/runs/${seed.snapshot.id}/cancel`, { method: "POST" })).status,
      ).toBe(409);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    const exited = new Promise<void>((resolve) => owner.once("exit", () => resolve()));
    owner.kill();
    await exited;
  }
});
