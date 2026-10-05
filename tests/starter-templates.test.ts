import { describe, expect, it } from "vitest";
import { createRunRecord, createRunSnapshot } from "../src/domain/run.js";
import {
  claimStep,
  completeStep,
  continueRepeat,
  readySteps,
  settleRun,
} from "../src/domain/scheduler.js";
import { exportPortableLoop, inspectPortableLoop } from "../src/domain/loop-portable.js";
import { parseLoop } from "../src/domain/loop.js";
import { createStarterDraft } from "../src/domain/starter-templates.js";

const ready = (record: ReturnType<typeof createRunRecord>): string[] =>
  readySteps(record).map((step) => step.id);
const finish = (record: ReturnType<typeof createRunRecord>, id: string, outcome?: string) =>
  completeStep(claimStep(record, id, "candidate-a", "input-a"), id, {
    status: "succeeded",
    ...(outcome ? { outcome } : {}),
  });
const start = () =>
  createRunRecord(
    createRunSnapshot(
      parseLoop({ ...createStarterDraft("staged", "owned-staged"), status: "published" }),
      { description: "Task" },
      { provider: "mock", model: "default" },
    ),
  );

describe("starter templates", () => {
  it("creates only draft definitions with portable semantic roles", () => {
    const compact = createStarterDraft("compact", "owned-compact");
    expect(compact.status).toBe("draft");
    expect(compact.steps.map((step) => step.name)).toEqual(["Implement", "Review", "Validate"]);
    expect(compact.steps.every((step) => !step.binding)).toBe(true);
    const staged = createStarterDraft("staged", "owned-staged");
    expect(staged.status).toBe("draft");
    expect(staged.steps).toHaveLength(15);
    expect(staged.steps.filter((step) => step.stage === "review")).toHaveLength(6);
    expect(staged.steps.every((step) => !step.binding)).toBe(true);
    expect(staged.policy.maxImplementationRounds).toBe(2);
    expect(staged.groups.find((group) => group.id === "implementation-round")).toMatchObject({
      kind: "repeat",
      maxIterations: 2,
    });
  });

  it("joins evidence and all six reviews, repairs once, and verifies the accepted candidate", () => {
    let record = start();
    expect(ready(record)).toEqual(["requirements"]);
    record = finish(record, "requirements");
    expect(ready(record)).toEqual(["domain-evidence", "ui-evidence"]);
    record = finish(record, "domain-evidence");
    expect(ready(record)).toEqual(["ui-evidence"]);
    record = finish(record, "ui-evidence");
    expect(ready(record)).toEqual(["plan"]);
    record = finish(record, "plan");
    const reviews = [
      "quality-review",
      "react-review",
      "performance-review",
      "security-review",
      "acceptance-review",
      "test-review",
    ];
    for (const outcome of ["repair", "pass"]) {
      record = finish(record, "implement");
      record = finish(record, "candidate");
      record = finish(record, "checks");
      expect(ready(record)).toEqual(reviews);
      for (const id of reviews.slice(0, -1)) record = finish(record, id);
      expect(ready(record)).toEqual(["test-review"]);
      record = finish(record, "test-review");
      expect(ready(record)).toEqual(["adjudicate"]);
      record = finish(record, "adjudicate", outcome);
      if (outcome === "repair") record = continueRepeat(record, "adjudicate");
      expect(ready(record)).toEqual(outcome === "repair" ? ["implement"] : ["final-verification"]);
    }
    expect(record.implementationRound).toBe(2);
    expect(ready(record)).toEqual(["final-verification"]);
    record = finish(record, "final-verification");
    expect(settleRun(record).status).toBe("succeeded");
    expect(record.steps.find((step) => step.stepId === "quality-review")?.attempts).toHaveLength(2);
  });

  it("rejects a second repair decision with both rounds retained", () => {
    let record = start();
    for (const id of ["requirements", "domain-evidence", "ui-evidence", "plan"]) {
      record = finish(record, id);
    }
    const round = () => {
      for (const id of [
        "implement",
        "candidate",
        "checks",
        "quality-review",
        "react-review",
        "performance-review",
        "security-review",
        "acceptance-review",
        "test-review",
      ])
        record = finish(record, id);
      record = finish(record, "adjudicate", "repair");
      record = continueRepeat(record, "adjudicate");
    };
    round();
    round();
    expect(record.status).toBe("rejected");
    expect(record.implementationRound).toBe(2);
    expect(record.steps.find((step) => step.stepId === "implement")?.attempts).toHaveLength(2);
  });
});

describe("canonical loop JSON", () => {
  it("round trips the graph and creates a new user-owned draft", () => {
    const original = createStarterDraft("staged", "first-owner");
    const exported = exportPortableLoop(original);
    expect(exported).not.toContain("first-owner");
    const result = inspectPortableLoop(exported, "second-owner");
    expect(result.errors).toEqual([]);
    expect(result.loop).toMatchObject({
      id: "second-owner",
      status: "draft",
      version: 1,
      steps: original.steps,
      dependencies: original.dependencies,
      groups: original.groups,
      joins: original.joins,
      decisions: original.decisions,
      policy: original.policy,
    });
    expect(exportPortableLoop(result.loop!)).toBe(exported);
  });

  it("returns field errors for malformed JSON, incompatible versions, and invalid graphs", () => {
    expect(inspectPortableLoop("{", "new").errors[0]).toMatch(/^JSON:/);
    const value = JSON.parse(exportPortableLoop(createStarterDraft("compact", "old"))) as {
      formatVersion: number;
      definition: { steps: { id: string }[] };
    };
    value.formatVersion = 99;
    expect(inspectPortableLoop(JSON.stringify(value), "new").errors).toEqual([
      expect.stringMatching(/^formatVersion:/),
    ]);
    value.formatVersion = 1;
    value.definition.steps[0]!.id = "INVALID ID";
    expect(inspectPortableLoop(JSON.stringify(value), "new").errors).toContainEqual(
      expect.stringMatching(/^definition.steps.0.id:/),
    );
  });
});
