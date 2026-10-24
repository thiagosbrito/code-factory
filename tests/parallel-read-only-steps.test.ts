import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AdapterEvent, StepExecutionInput } from "../src/adapters/contract.js";
import { mockAdapter } from "../src/adapters/mock.js";
import { parseLoop } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot } from "../src/domain/run.js";
import {
  MAX_CONCURRENT_READ_ONLY_STEPS,
  readySteps,
  selectRunnable,
} from "../src/domain/scheduler.js";
import { claim } from "./support/scheduler.js";
import { readRun } from "../src/runtime/storage.js";
import { cancelRun, executeRun } from "../src/runtime/scheduler.js";
import {
  createProjectRun,
  git,
  implement,
  outcome,
  removeParents,
  repository,
  savedEnv,
} from "./support/run-branch.js";

afterEach(async () => {
  process.env = { ...savedEnv };
  await removeParents();
});

const analytical = (id: string, stage = "evidence") => ({
  id,
  name: id,
  kind: "agent",
  stage,
  role: "analyst",
  instruction: id,
  groupId: "group",
});

const groupLoop = (
  steps: Record<string, unknown>[],
  dependencies: { from: string; to: string }[] = [],
  members = steps.filter((step) => step.groupId).map((step) => String(step.id)),
) =>
  parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 1,
    status: "published",
    steps,
    dependencies,
    groups: members.length
      ? [{ id: "group", name: "Group", kind: "parallel", stepIds: members }]
      : [],
    joins: [],
    decisions: [],
    policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 1 },
  });

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/** Records start/end order and the most steps ever running at once; `body` is the controlled part. */
const controlled = (body: (input: StepExecutionInput, signal: AbortSignal) => Promise<void>) => {
  const log: string[] = [];
  let running = 0;
  let max = 0;
  const adapter = {
    ...mockAdapter,
    async *execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent> {
      log.push(`start:${input.stepId}`);
      max = Math.max(max, ++running);
      try {
        await body(input, signal);
      } finally {
        running -= 1;
        log.push(`end:${input.stepId}`);
      }
      yield* mockAdapter.execute(input, signal);
    },
  };
  return { adapter, log, max: () => max };
};

/** Resolves once `count` distinct steps have called it, so each can wait for its siblings. */
const rendezvous = (count: number) => {
  const seen = new Set<string>();
  const ready = deferred();
  return async (id: string) => {
    seen.add(id);
    if (seen.size === count) ready.resolve();
    await ready.promise;
  };
};

describe("parallel read-only steps", { timeout: 30_000 }, () => {
  it("runs independent evidence steps of a parallel group at the same time", async () => {
    const { root } = await repository();
    const meet = rendezvous(2);
    // Each step can only finish once the other has started: a sequential scheduler never gets there.
    const probe = controlled((input) => meet(input.stepId));
    const run = await createProjectRun(root, groupLoop([analytical("one"), analytical("two")]));
    const done = await executeRun(root, run.snapshot.id, () => probe.adapter);
    expect(outcome(done)).toEqual({ status: "succeeded", failures: [] });
    expect(probe.max()).toBe(2);
    const sequences = done.evidence
      .filter((item) => item.kind === "event")
      .map((item) => item.sequence);
    expect(sequences).toEqual(sequences.map((_, index) => index));
    expect(git(root, "log", "--format=%s", "main..HEAD")).toBe("");
  });

  it("starts a dependent step only after every parallel member has finished", async () => {
    const { root } = await repository();
    const probe = controlled(() => Promise.resolve());
    const loop = groupLoop(
      [
        analytical("one"),
        analytical("two"),
        { ...analytical("summary", "planning"), groupId: undefined },
      ],
      [
        { from: "one", to: "summary" },
        { from: "two", to: "summary" },
      ],
      ["one", "two"],
    );
    const run = await createProjectRun(root, loop);
    const done = await executeRun(root, run.snapshot.id, () => probe.adapter);
    expect(done.status).toBe("succeeded");
    const start = probe.log.indexOf("start:summary");
    expect(start).toBeGreaterThan(probe.log.indexOf("end:one"));
    expect(start).toBeGreaterThan(probe.log.indexOf("end:two"));
  });

  it("never runs more than the cap at once and still finishes every member", async () => {
    const { root } = await repository();
    // The first round only completes when MAX steps run together; later members start afterwards.
    const meet = rendezvous(MAX_CONCURRENT_READ_ONLY_STEPS);
    const probe = controlled((input) => meet(input.stepId));
    const ids = ["a", "b", "c", "d", "e", "f"];
    const run = await createProjectRun(root, groupLoop(ids.map((id) => analytical(id))));
    const done = await executeRun(root, run.snapshot.id, () => probe.adapter);
    expect(done.steps.map((step) => step.status)).toEqual(ids.map(() => "succeeded"));
    expect(probe.max()).toBe(MAX_CONCURRENT_READ_ONLY_STEPS);
  });

  it("runs a writing step in the group alone, before any read-only sibling", async () => {
    const { root } = await repository();
    const probe = controlled(async (input) => {
      if (input.stepId === "implement")
        await writeFile(join(input.projectDirectory, "feature.txt"), "feature\n");
    });
    const loop = groupLoop(
      [analytical("one"), analytical("two"), { ...implement, groupId: "group" }],
      [],
      ["one", "two", "implement"],
    );
    const run = await createProjectRun(root, loop);
    const done = await executeRun(root, run.snapshot.id, () => probe.adapter);
    expect(done.status).toBe("succeeded");
    expect(probe.log.slice(0, 2)).toEqual(["start:implement", "end:implement"]);
    expect(git(root, "log", "--format=%s", "main..HEAD")).toContain("(implement)");
  });

  it("fails every overlapping step against one shared tree and commits nothing when a sibling edits the project", async () => {
    const { root } = await repository();
    const meet = rendezvous(2);
    const edited = deferred();
    const probe = controlled(async (input) => {
      await meet(input.stepId);
      if (input.stepId === "one") {
        await writeFile(join(input.projectDirectory, "feature.txt"), "premature\n");
        edited.resolve();
      } else await edited.promise;
    });
    const run = await createProjectRun(root, groupLoop([analytical("one"), analytical("two")]));
    const done = await executeRun(root, run.snapshot.id, () => probe.adapter);
    expect(done.status).toBe("failed");
    const failures = outcome(done).failures;
    expect(failures).toHaveLength(2);
    for (const failure of failures) expect(failure).toContain("changed project files");
    expect(git(root, "log", "--format=%s", "main..HEAD")).toBe("");
  });

  it("starts all six ready reviews in one round", async () => {
    const { root } = await repository();
    const meet = rendezvous(6);
    const probe = controlled((input) => meet(input.stepId));
    const ids = ["r1", "r2", "r3", "r4", "r5", "r6"];
    const reviews = ids.map((id) => ({ ...analytical(id, "review"), groupId: undefined }));
    const run = await createProjectRun(root, groupLoop(reviews, [], []));
    const done = await executeRun(root, run.snapshot.id, () => probe.adapter);
    expect(done.status).toBe("succeeded");
    expect(probe.max()).toBe(6);
  });

  it("keeps the result of a step that finished before a sibling edited the project", async () => {
    const { root } = await repository();
    const meet = rendezvous(2);
    const twoFinished = deferred();
    const probe = controlled(async (input) => {
      await meet(input.stepId);
      if (input.stepId === "one") {
        await twoFinished.promise;
        await writeFile(join(input.projectDirectory, "feature.txt"), "late\n");
      }
    });
    const run = await createProjectRun(root, groupLoop([analytical("one"), analytical("two")]));
    const work = executeRun(root, run.snapshot.id, () => probe.adapter);
    // Release step one only once step two has settled durably in the run record.
    let settled = "";
    while (!["succeeded", "failed", "canceled"].includes(settled)) {
      const current = await readRun(root, run.snapshot.id);
      settled = current?.steps.find((step) => step.stepId === "two")?.status ?? "";
      if (!settled || settled === "pending" || settled === "running")
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    twoFinished.resolve();
    expect(settled).toBe("succeeded");
    const done = await work;
    const status = Object.fromEntries(done.steps.map((step) => [step.stepId, step.status]));
    expect(status).toEqual({ one: "failed", two: "succeeded" });
    expect(
      done.evidence.some((item) => item.kind === "event" && item.title === "read-only-violation"),
    ).toBe(true);
    expect(git(root, "log", "--format=%s", "main..HEAD")).toBe("");
  });

  it("lets a sibling finish when another parallel step fails", async () => {
    const { root } = await repository();
    const oneFailed = deferred();
    const adapter = {
      ...mockAdapter,
      async *execute(input: StepExecutionInput): AsyncIterable<AdapterEvent> {
        const session = {
          runId: input.runId,
          stepId: input.stepId,
          attempt: input.attempt,
          sessionId: `s-${input.stepId}`,
          turnId: `t-${input.stepId}`,
        };
        yield { type: "started", ...session };
        if (input.stepId === "one") {
          oneFailed.resolve();
          yield {
            type: "completed",
            outcome: "failed",
            output: "boom",
            ...session,
          };
        } else {
          await oneFailed.promise;
          yield {
            type: "completed",
            outcome: "succeeded",
            output: "ok",
            ...session,
          };
        }
      },
    };
    const run = await createProjectRun(root, groupLoop([analytical("one"), analytical("two")]));
    const done = await executeRun(root, run.snapshot.id, () => adapter);
    expect(done.status).toBe("failed");
    expect(Object.fromEntries(done.steps.map((step) => [step.stepId, step.status]))).toEqual({
      one: "failed",
      two: "succeeded",
    });
  });

  it("cancels every in-flight parallel step", async () => {
    const { root } = await repository();
    const meet = rendezvous(2);
    const bothRunning = deferred();
    const probe = controlled(async (input, signal) => {
      await meet(input.stepId);
      bothRunning.resolve();
      await new Promise<void>((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    });
    const run = await createProjectRun(root, groupLoop([analytical("one"), analytical("two")]));
    const work = executeRun(root, run.snapshot.id, () => probe.adapter);
    await bothRunning.promise;
    await cancelRun(root, run.snapshot.id);
    const done = await work;
    expect(done.status).toBe("canceled");
    expect(done.steps.map((step) => step.attempts.at(-1)?.status)).toEqual([
      "canceled",
      "canceled",
    ]);
  });
});

describe("selectRunnable", () => {
  const pick = async (steps: Record<string, unknown>[], members: string[]) => {
    const { root } = await repository();
    const record = await createProjectRun(root, groupLoop(steps, [], members));
    return selectRunnable(record, readySteps(record)).map((step) => step.id);
  };

  it("batches grouped read-only steps up to the cap", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    expect(
      await pick(
        ids.map((id) => analytical(id)),
        ids,
      ),
    ).toEqual(ids.slice(0, MAX_CONCURRENT_READ_ONLY_STEPS));
  });

  it("starts every ready review but caps grouped evidence", async () => {
    const reviews = ["a", "b", "c", "d", "e", "f"].map((id) => ({
      ...analytical(id, "review"),
      groupId: undefined,
    }));
    const evidence = ["x", "y", "z", "u", "v", "w"].map((id) => analytical(id));
    expect(await pick(reviews, [])).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(
      await pick(
        evidence,
        evidence.map((item) => item.id),
      ),
    ).toEqual(["x", "y", "z", "u"]);
  });

  it("keeps a writer alone and ahead of read-only siblings", async () => {
    expect(
      await pick(
        [analytical("a"), { ...implement, groupId: "group" }, analytical("b")],
        ["a", "implement", "b"],
      ),
    ).toEqual(["implement"]);
  });

  it("keeps analytical steps outside a parallel group sequential", async () => {
    expect(
      await pick(
        [
          { ...analytical("a"), groupId: undefined },
          { ...analytical("b"), groupId: undefined },
          analytical("x"),
          analytical("y"),
        ],
        ["x", "y"],
      ),
    ).toEqual(["a"]);
  });
});

describe("claimStep exclusivity", () => {
  const evidenceLoop = (steps: Record<string, unknown>[]) =>
    createRunRecord(
      createRunSnapshot(
        groupLoop(
          steps,
          [],
          steps.filter((item) => item.groupId).map((item) => String(item.id)),
        ),
        { description: "Task" },
        { provider: "mock", model: "default" },
      ),
    );

  it("lets read-only evidence steps hold the workspace together", () => {
    const record = evidenceLoop([analytical("one"), analytical("two")]);
    const claimed = claim(claim(record, "one"), "two");
    expect(claimed.steps.filter((item) => item.status === "running")).toHaveLength(2);
  });

  it("refuses an ungrouped analytical step beside a running evidence step", () => {
    const record = evidenceLoop([
      analytical("one"),
      analytical("two"),
      { ...analytical("solo"), groupId: undefined },
    ]);
    expect(() => claim(claim(record, "one"), "solo")).toThrow(/Conflicting workspace/);
  });

  it("refuses a writer beside a running evidence step, and an evidence step beside a writer", () => {
    const record = evidenceLoop([analytical("one"), { ...implement, groupId: "group" }]);
    expect(() => claim(claim(record, "one"), "implement")).toThrow(/Conflicting workspace/);
    expect(() => claim(claim(record, "implement"), "one")).toThrow(/writer is active/);
  });
});
