import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeRun, retryStep } from "../src/runtime/scheduler.js";
import { createRunRecord, createRunSnapshot, type RunRecord } from "../src/domain/run.js";
import { readySteps, prepareStepRetry, retryBlocker } from "../src/domain/scheduler.js";
import {
  type ScriptedInstructions,
  blockedLoop,
  claim,
  legacyRun,
  pass,
  reviewerIds,
  scriptedAdapter,
} from "./support/scheduler.js";

describe("blocked review recovery", () => {
  it("holds adjudication behind a blocked reviewer, then runs it after that reviewer is retried", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-blocked-"));
    try {
      const record = await legacyRun(root);
      const outputs: Record<string, string[]> = {
        build: ["built"],
        adjudicate: ["adjudicated"],
        ...Object.fromEntries(reviewerIds.slice(0, 5).map((id) => [id, ["pass"]])),
        r6: ["blocked\nCannot run yarn test: shell refused.", "pass"],
      };
      const seen: ScriptedInstructions = {};
      const blocked = await executeRun(root, record.snapshot.id, () =>
        scriptedAdapter(outputs, seen),
      );
      expect(blocked.status).toBe("blocked");
      expect(readySteps(blocked)).toEqual([]);
      expect(blocked.steps.find((item) => item.stepId === "adjudicate")?.status).toBe("pending");
      const attempt = blocked.steps.find((item) => item.stepId === "r6")?.attempts.at(-1);
      if (!attempt) throw new Error("Missing reviewer attempt");
      expect(retryBlocker(blocked, "r6")).toBeNull();
      expect(retryBlocker(blocked, "r1")).toBe(
        "Only a failed step in a failed run can be retried.",
      );
      const retried = await retryStep(root, record.snapshot.id, "r6", attempt.id, () =>
        scriptedAdapter(outputs, seen),
      );
      expect(retried.status).toBe("succeeded");
      expect(retried.steps.find((item) => item.stepId === "adjudicate")?.status).toBe("succeeded");
      expect(
        retried.evidence.some(
          (item) => item.kind === "event" && item.title === "selected-step-retry",
        ),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the run blocked while another reviewer still holds a blocked verdict, and respects the budget", () => {
    let record = createRunRecord(
      createRunSnapshot(
        blockedLoop(),
        { description: "Task" },
        { provider: "mock", model: "default" },
      ),
    );
    record = pass(claim(record, "build"), "build");
    for (const id of reviewerIds) record = claim(record, id);
    for (const id of reviewerIds)
      record = pass(record, id, id === "r5" || id === "r6" ? "blocked" : "pass");
    expect(record.status).toBe("blocked");
    const retryReviewer = (current: RunRecord, id: string, outcome: string) => {
      const attemptId = current.steps.find((item) => item.stepId === id)?.attempts.at(-1)?.id ?? "";
      return pass(claim(prepareStepRetry(current, id, attemptId), id), id, outcome);
    };
    record = retryReviewer(record, "r5", "pass");
    expect(record.status).toBe("blocked");
    expect(readySteps(record)).toEqual([]);
    expect(record.steps.find((item) => item.stepId === "adjudicate")?.status).toBe("pending");
    expect(retryBlocker(record, "r6")).toBeNull();
    record = retryReviewer(record, "r6", "blocked");
    expect(retryBlocker(record, "r6")).toBe("Attempt limit reached for this step.");
    expect(() =>
      prepareStepRetry(
        record,
        "r6",
        record.steps.find((item) => item.stepId === "r6")?.attempts.at(-1)?.id ?? "",
      ),
    ).toThrow("Attempt limit reached for this step.");
  });

  it("allows a second blocker's retry to release adjudication", () => {
    let record = createRunRecord(
      createRunSnapshot(
        blockedLoop(),
        { description: "Task" },
        { provider: "mock", model: "default" },
      ),
    );
    record = pass(claim(record, "build"), "build");
    for (const id of reviewerIds) record = claim(record, id);
    for (const id of reviewerIds)
      record = pass(record, id, id === "r5" || id === "r6" ? "blocked" : "pass");
    for (const id of ["r5", "r6"]) {
      const attemptId = record.steps.find((item) => item.stepId === id)?.attempts.at(-1)?.id ?? "";
      record = pass(claim(prepareStepRetry(record, id, attemptId), id), id, "pass");
    }
    expect(record.status).toBe("running");
    expect(readySteps(record).map((item) => item.id)).toEqual(["adjudicate"]);
  });
});
