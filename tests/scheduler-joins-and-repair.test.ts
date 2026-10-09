import { describe, expect, it } from "vitest";
import { completeStep, continueRepeat, readySteps, settleRun } from "../src/domain/scheduler.js";
import { claim, pass, run, step } from "./support/scheduler.js";

describe("portable scheduler", () => {
  it("waits for both explicit join sources while parallel reviewers retain independent attempts", () => {
    let record = run();
    expect(readySteps(record).map((item) => item.id)).toEqual(["build"]);
    record = pass(claim(record, "build"), "build");
    expect(readySteps(record).map((item) => item.id)).toEqual(["quality", "security"]);
    record = claim(claim(record, "quality"), "security");
    expect(() => claim(record, "quality")).toThrow(/not ready/);
    record = pass(record, "quality");
    expect(readySteps(record)).toEqual([]);
    record = pass(record, "security");
    expect(readySteps(record).map((item) => item.id)).toEqual(["join"]);
    expect(record.steps.find((item) => item.stepId === "quality")?.attempts).toHaveLength(1);
    expect(record.steps.find((item) => item.stepId === "security")?.attempts).toHaveLength(1);
    record = pass(claim(record, "join"), "join");
    expect(settleRun(record).status).toBe("succeeded");
  });

  it("joins only the selected decision branch and skips the inactive branch", () => {
    let record = run({
      steps: [step("decide"), step("left"), step("right"), step("join")],
      dependencies: [
        { from: "decide", to: "left" },
        { from: "decide", to: "right" },
        { from: "left", to: "join" },
        { from: "right", to: "join" },
      ],
      groups: [],
      joins: [{ stepId: "join", mode: "all", from: ["left", "right"] }],
      decisions: [
        {
          stepId: "decide",
          branches: [
            { outcome: "left", to: "left" },
            { outcome: "right", to: "right" },
          ],
        },
      ],
    });
    record = pass(claim(record, "decide"), "decide", "left");
    expect(record.steps.find((item) => item.stepId === "right")?.status).toBe("skipped");
    expect(readySteps(record).map((item) => item.id)).toEqual(["left"]);
    record = pass(claim(record, "left"), "left");
    expect(readySteps(record).map((item) => item.id)).toEqual(["join"]);
  });

  it("freezes the same candidate for reviewers and prevents a concurrent writer", () => {
    let record = pass(claim(run(), "build"), "build");
    record = claim(record, "quality");
    record = claim(record, "security");
    expect(
      record.steps.filter((item) => item.status === "running").map((item) => item.candidateId),
    ).toEqual(["candidate-a", "candidate-a"]);
    expect(record.steps.find((item) => item.stepId === "quality")?.inputHash).toBe(
      record.steps.find((item) => item.stepId === "security")?.inputHash,
    );
    expect(() => claim(record, "join")).toThrow(/not ready/);
    const parallel = run({
      steps: [step("a", "implementation"), step("b", "implementation")],
      dependencies: [],
      groups: [],
      joins: [],
    });
    expect(() => claim(claim(parallel, "a"), "b")).toThrow(/Conflicting workspace/);
  });

  it("returns to the repeat body once, then aborts a second rejection with history intact", () => {
    let record = run({
      steps: [
        step("build", "implementation", "repair"),
        step("review", "review", "repair"),
        step("done"),
      ],
      dependencies: [
        { from: "build", to: "review" },
        { from: "review", to: "done" },
      ],
      groups: [
        {
          id: "repair",
          name: "Repair",
          kind: "repeat",
          stepIds: ["build", "review"],
          maxIterations: 2,
          exitWhen: { stepId: "review", outcome: "pass" },
          continueWhen: { outcome: "changes-requested", to: "build" },
        },
      ],
      joins: [],
      decisions: [
        {
          stepId: "review",
          branches: [
            { outcome: "pass", to: "done" },
            { outcome: "changes-requested", to: "build" },
          ],
        },
      ],
    });
    record = pass(claim(record, "build"), "build");
    record = pass(claim(record, "review"), "review", "changes-requested");
    record = continueRepeat(record, "review");
    expect(record.implementationRound).toBe(2);
    expect(record.steps.find((item) => item.stepId === "build")?.status).toBe("pending");
    record = pass(claim(record, "build"), "build");
    record = pass(claim(record, "review"), "review", "changes-requested");
    record = continueRepeat(record, "review");
    expect(record.status).toBe("rejected");
    expect(record.steps.find((item) => item.stepId === "build")?.attempts).toHaveLength(2);
  });

  it("succeeds after one repair and keeps terminal causes distinct", () => {
    const definition = {
      steps: [
        step("build", "implementation", "repair"),
        step("review", "review", "repair"),
        step("done"),
      ],
      dependencies: [
        { from: "build", to: "review" },
        { from: "review", to: "done" },
      ],
      groups: [
        {
          id: "repair",
          name: "Repair",
          kind: "repeat",
          stepIds: ["build", "review"],
          maxIterations: 2,
          exitWhen: { stepId: "review", outcome: "pass" },
          continueWhen: { outcome: "changes-requested", to: "build" },
        },
      ],
      joins: [],
      decisions: [
        {
          stepId: "review",
          branches: [
            { outcome: "pass", to: "done" },
            { outcome: "changes-requested", to: "build" },
          ],
        },
      ],
    };
    let record = pass(claim(run(definition), "build"), "build");
    record = pass(claim(record, "review"), "review", "changes-requested");
    record = continueRepeat(record, "review");
    record = pass(claim(record, "build"), "build");
    record = pass(claim(record, "review"), "review", "pass");
    record = pass(claim(record, "done"), "done");
    expect(settleRun(record).status).toBe("succeeded");
    for (const status of ["failed", "canceled", "unavailable"] as const) {
      const outcome = completeStep(claim(run(), "build"), "build", { status });
      expect(outcome.status).toBe(status);
      expect(readySteps(outcome)).toEqual([]);
    }
  });
});
