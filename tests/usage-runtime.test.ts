import { afterEach, describe, expect, it } from "vitest";
import type { AdapterEvent, StepExecutionInput } from "../src/adapters/contract.js";
import { mockAdapter } from "../src/adapters/mock.js";
import type { UsageReport } from "../src/domain/usage.js";
import { summarizeUsage } from "../src/domain/usage.js";
import { executeRun } from "../src/runtime/scheduler.js";
import { readRun } from "../src/runtime/storage.js";
import {
  createProjectRun,
  loopWith,
  removeParents,
  repository,
  review,
  savedEnv,
} from "./support/run-branch.js";

afterEach(async () => {
  process.env = { ...savedEnv };
  await removeParents();
});

/** The mock agent, reporting `reports` (one usage event each) just before it completes. */
const reporting = (reports: UsageReport[]) => ({
  ...mockAdapter,
  async *execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent> {
    let session: Extract<AdapterEvent, { type: "started" }> | undefined;
    for await (const event of mockAdapter.execute(input, signal)) {
      if (event.type === "started") session = event;
      if (event.type === "completed" && session)
        for (const usage of reports) yield { ...session, type: "usage", usage };
      yield event;
    }
  },
});

const usageOf = { tokens: { input: 7, output: 0 } };

describe("usage evidence in the runtime", { timeout: 30_000 }, () => {
  it("persists an adapter's usage as one receipt without disturbing event sequences", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root, loopWith([review], []));
    const done = await executeRun(root, run.snapshot.id, () => reporting([usageOf]));
    expect(done.status).toBe("succeeded");
    const receipts = done.evidence.filter((item) => item.kind === "usage");
    expect(receipts).toMatchObject([
      { stepId: "review", attemptId: done.steps[0]?.attempts[0]?.id, tokens: usageOf.tokens },
    ]);
    const sequences = done.evidence
      .filter((item) => item.kind === "event")
      .map((item) => item.sequence);
    expect(sequences).toEqual(sequences.map((_, index) => index));
    expect(done.evidence.some((item) => item.kind === "event" && item.title === "usage")).toBe(
      false,
    );
    const reloaded = await readRun(root, run.snapshot.id);
    if (!reloaded) throw new Error("The run was not persisted.");
    expect(summarizeUsage(reloaded)).toMatchObject({
      reported: 1,
      partial: false,
      tokens: { input: 7, output: 0, cacheRead: null, cacheWrite: null },
      cost: null,
    });
  });

  it("records nothing for an agent that reports no usage", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root, loopWith([review], []));
    const done = await executeRun(root, run.snapshot.id, () => mockAdapter);
    expect(done.evidence.filter((item) => item.kind === "usage")).toEqual([]);
    expect(summarizeUsage(done)).toMatchObject({ attempts: 1, reported: 0, partial: true });
  });

  it("keeps the first report when an adapter repeats itself for one attempt", async () => {
    const { root } = await repository();
    const run = await createProjectRun(root, loopWith([review], []));
    const done = await executeRun(root, run.snapshot.id, () =>
      reporting([usageOf, { tokens: { input: 1000 } }]),
    );
    expect(done.evidence.filter((item) => item.kind === "usage")).toHaveLength(1);
    expect(summarizeUsage(done).tokens?.input).toBe(7);
  });
});
