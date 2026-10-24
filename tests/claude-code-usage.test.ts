import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code.js";
import type { AdapterEvent, StepExecutionInput } from "../src/adapters/contract.js";
import { removeNodeFixtureDirectory, writeNodeExecutable } from "./support/node-executable.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map(removeNodeFixtureDirectory)));

/** A fake `claude` step: prints the first batch of events on the first message, the second on the next. */
const fake = async (batches: unknown[][]) => {
  const directory = await mkdtemp(join(tmpdir(), "code-factory-claude-usage-"));
  directories.push(directory);
  const executable = join(directory, "claude");
  await writeNodeExecutable(
    executable,
    `#!/usr/bin/env node
const batches = ${JSON.stringify(batches)};
let seen = 0;
require('readline').createInterface({ input: process.stdin }).on('line', () => {
  for (const event of batches[seen] ?? []) console.log(JSON.stringify(event));
  seen += 1;
  if (seen >= batches.length) process.exit(0);
});
`,
  );
  return { directory, executable };
};

const init = { type: "system", subtype: "init", session_id: "s1" };
const result = (extra: Record<string, unknown> = {}, subtype = "success") => ({
  type: "result",
  subtype,
  is_error: subtype !== "success",
  session_id: "s1",
  result: "done",
  ...extra,
});
const input = (directory: string): StepExecutionInput => ({
  runId: "run-1",
  stepId: "step-1",
  attempt: 1,
  instruction: "Do it",
  binding: { provider: "claude-code", model: "agent-default" },
  projectDirectory: directory,
});
const collect = async (batches: unknown[][], guidance?: string) => {
  const { directory, executable } = await fake(batches);
  const adapter = new ClaudeCodeAdapter(executable, "2.1.310");
  const events: AdapterEvent[] = [];
  for await (const event of adapter.execute(input(directory), new AbortController().signal)) {
    events.push(event);
    if (event.type === "started" && guidance) await adapter.steer(event, guidance);
  }
  return events;
};
const usageEvents = (events: AdapterEvent[]) => events.filter((event) => event.type === "usage");

describe("Claude Code usage reporting", () => {
  it("reports tokens and the estimated cost from the result event before completion", async () => {
    const events = await collect([
      [
        init,
        result({
          usage: {
            input_tokens: 12,
            output_tokens: 34,
            cache_read_input_tokens: 56,
            cache_creation_input_tokens: 78,
            service_tier: "standard",
          },
          total_cost_usd: 0.0123,
          modelUsage: { x: {} },
        }),
      ],
    ]);
    expect(events.map((event) => event.type)).toEqual(["started", "usage", "completed"]);
    expect(usageEvents(events)[0]).toMatchObject({
      usage: {
        tokens: { input: 12, output: 34, cacheRead: 56, cacheWrite: 78 },
        cost: { amount: 0.0123, currency: "USD", source: "provider-estimate" },
        note: expect.stringContaining("subagent"),
      },
    });
  });

  it("keeps reported zeros", async () => {
    const events = await collect([
      [init, result({ usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0 })],
    ]);
    expect(usageEvents(events)[0]).toMatchObject({
      usage: { tokens: { input: 0, output: 0 }, cost: { amount: 0 } },
    });
  });

  it("reports nothing when the result has no usage or cost", async () => {
    const events = await collect([[init, result()]]);
    expect(usageEvents(events)).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "completed", outcome: "succeeded" });
  });

  it("drops malformed fields without failing the step or inventing zeros", async () => {
    const events = await collect([
      [
        init,
        result({
          usage: { input_tokens: "12", output_tokens: -4, cache_read_input_tokens: 5.5 },
          total_cost_usd: "free",
        }),
      ],
    ]);
    expect(usageEvents(events)).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "completed", outcome: "succeeded" });
    const partial = await collect([
      [init, result({ usage: { input_tokens: 9, output_tokens: null }, total_cost_usd: -1 })],
    ]);
    expect(usageEvents(partial)[0]).toMatchObject({ usage: { tokens: { input: 9 } } });
    expect(usageEvents(partial)[0]).not.toHaveProperty("usage.cost");
    expect(usageEvents(partial)[0]).not.toHaveProperty("usage.tokens.output");
  });

  it("reports a failed result's usage but ignores a crash result's zeroed metrics", async () => {
    const failed = await collect([
      [init, result({ usage: { input_tokens: 3 }, total_cost_usd: 0.5 }, "error_max_turns")],
    ]);
    expect(usageEvents(failed)).toHaveLength(1);
    expect(failed.at(-1)).toMatchObject({ outcome: "failed" });
    const crashed = await collect([
      [init, result({ usage: { input_tokens: 0 }, total_cost_usd: 0 }, "error_during_execution")],
    ]);
    expect(usageEvents(crashed)).toEqual([]);
  });

  it("sums per-turn tokens and takes the running cost total once when guidance adds a turn", async () => {
    const events = await collect(
      [
        [init],
        [
          result({ usage: { input_tokens: 10, output_tokens: 1 }, total_cost_usd: 0.1 }),
          result({ usage: { input_tokens: 5, output_tokens: 2 }, total_cost_usd: 0.25 }),
        ],
      ],
      "more",
    );
    expect(usageEvents(events)).toHaveLength(1);
    expect(usageEvents(events)[0]).toMatchObject({
      usage: { tokens: { input: 15, output: 3 }, cost: { amount: 0.25 } },
    });
  });
});
