import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockAdapter } from "../src/adapters/mock.js";
import { type AdapterEvent, type StepExecutionInput } from "../src/adapters/contract.js";
import { executeRun } from "../src/runtime/scheduler.js";
import { parseLoop } from "../src/domain/loop.js";
import { type RunRecord } from "../src/domain/run.js";
import { initializeProject } from "../src/runtime/project.js";
import {
  grantToolPermission,
  revokeToolPermission,
  trustDirectory,
  trustProject,
} from "../src/runtime/trust.js";
import { legacyRun, step } from "./support/scheduler.js";

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
