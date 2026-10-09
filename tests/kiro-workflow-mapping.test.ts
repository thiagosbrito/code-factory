import { describe, expect, it } from "vitest";
import { parseLoop, type LoopDefinition } from "../src/domain/loop.js";
import { importerGeneratedRole } from "../src/translators/contract.js";
import { kiroWorkflowTranslator } from "../src/translators/kiro-workflow.js";
import { maxJsonLength } from "../src/translators/kiro-workflow-ids.js";
import {
  blankDraft,
  edges,
  failure,
  fixture,
  importText,
  joinsOf,
  repeat,
  step,
  stepOf,
  workflowText,
} from "./support/kiro-workflow-import.js";

const importSteps = (steps: unknown[], extra: Record<string, unknown> = {}) =>
  importText(workflowText(steps, extra));

const importFailure = (steps: unknown[]) => failure(() => importSteps(steps));

const parallel = (id: string, branches: unknown[], joinPolicy = "all") => ({
  type: "parallel",
  id,
  joinPolicy,
  branches,
});

const sequence = (id: string, steps: unknown[]) => ({ type: "sequence", id, steps });

const watch = (id: string) => ({ type: "watch", id, handler: "on-save" });

describe("kiro workflow translator: mapping rules", () => {
  it("rejects workflows the loop model cannot represent", () => {
    expect(importFailure([repeat("outer", [repeat("inner", [step("a")])])])).toBe(
      "steps[0].steps[0]: nested Kiro repeats cannot be represented.",
    );
    expect(importFailure([repeat("r", [step("a"), parallel("p", [step("b"), step("c")])])])).toBe(
      "steps[0]: repeat r must end with a single step that can carry its stop decision.",
    );
    expect(importFailure([watch("w")])).toBe("Kiro workflow has no importable steps.");
    expect(importFailure([sequence("a", [step("a")])])).toBe(
      'steps[0].steps[0].id: duplicate Kiro id "a"',
    );
  });

  it("decides a repeat in a generated step so the last body step keeps its stage", () => {
    const { loop, report } = importSteps([
      repeat("loop", [step("preview-build"), step("final-review", { agent: "ui-reviewer" })]),
      step("ship"),
    ]);
    expect(stepOf(loop, "final-review").stage).toBe("review");
    expect(stepOf(loop, "final-review").instruction).toBe("final-review step.");
    expect(stepOf(loop, "preview-build").stage).toBeUndefined();
    expect(loop.decisions).toEqual([
      {
        stepId: "loop-decision",
        branches: [
          { outcome: "stop", to: "ship" },
          { outcome: "continue", to: "preview-build" },
        ],
      },
    ]);
    // A single successor is the stop target, so no exit step is generated.
    expect(loop.steps.map(({ id }) => id)).toEqual([
      "preview-build",
      "final-review",
      "loop-decision",
      "ship",
    ]);
    expect(edges(loop)).toEqual(
      ["preview-build→final-review", "final-review→loop-decision", "loop-decision→ship"].sort(),
    );
    expect(stepOf(loop, "loop-decision")).toMatchObject({
      role: importerGeneratedRole,
      groupId: "loop",
    });
    expect(stepOf(loop, "loop-decision").instruction).toContain(
      "Kiro stop condition: none (Kiro repeats until the round limit).",
    );
    expect(report.issues).toContainEqual({
      field: "steps[0].steps[1]",
      kind: "lossy",
      message:
        'Review step "final-review" is inside Kiro repeat "loop": a "changes-requested" verdict rejects the run instead of starting another round.',
    });
  });

  it("reports parallel scheduling and any-join differences", () => {
    const { report } = importSteps([
      step("start"),
      parallel("work", [step("a"), step("b")], "any"),
      parallel("reviews", [step("r1-review"), step("r2-review")]),
    ]);
    const at = (field: string) =>
      report.issues.filter((item) => item.field === field).map(({ message }) => message);
    expect(at("steps[1]")).toEqual([
      "Parallel work: Code Factory starts one non-review step at a time, so these branches run one after another instead of concurrently.",
    ]);
    expect(at("steps[1].joinPolicy")).toEqual([
      "any imported as an any join: the next step becomes ready once one branch succeeds, but the other branches are not canceled, and review steps started together are all awaited before another step starts.",
    ]);
    expect(at("steps[2]")).toEqual([]);
  });

  it("states the run-time fallback for every Kiro repeat-limit policy", () => {
    const onMax = (policy: string) =>
      importSteps([repeat("r", [step("a")], { onMaxIterations: policy })]).report.issues.find(
        ({ field }) => field === "steps[0].onMaxIterations",
      );
    expect(onMax("abort")).toEqual({
      field: "steps[0].onMaxIterations",
      kind: "lossy",
      message: "Code Factory rejects the run when the round limit is reached.",
    });
    expect(onMax("continue")).toEqual({
      field: "steps[0].onMaxIterations",
      kind: "unsupported",
      message:
        'Kiro onMaxIterations "continue" has no loop equivalent; Code Factory rejects the run when the round limit is reached instead of continuing after the repeat.',
    });
    expect(onMax("pause")?.message).toBe(
      'Kiro onMaxIterations "pause" has no loop equivalent; Code Factory rejects the run when the round limit is reached instead of pausing.',
    );
  });

  it("reports loop validation failures with field paths", () => {
    const draft: LoopDefinition = {
      ...blankDraft(),
      policy: { maxAttemptsPerStep: 3, maxImplementationRounds: 0 },
    };
    expect(failure(() => kiroWorkflowTranslator.import(workflowText([step("a")]), draft))).toMatch(
      /^Kiro workflow could not be represented as a valid loop: policy\.maxImplementationRounds: /,
    );
  });

  it("notes a model inherited from the workflow default", () => {
    const { loop, report } = importSteps([step("a")], { modelId: "m1" });
    expect(stepOf(loop, "a").instruction).toContain(
      'Code Factory import note: Kiro model "m1" (workflow default) (not bound; choose a binding in the editor).',
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({ field: "modelId", kind: "unsupported" }),
    );
    expect(report.issues.some(({ field }) => field === "steps[0].modelId")).toBe(false);
  });

  it("imports a parallel with one importable branch as plain steps", () => {
    const { loop, report } = importSteps([
      step("a"),
      parallel("p", [step("b"), watch("w")], "allSettled"),
      step("c"),
    ]);
    expect(loop.groups).toEqual([]);
    expect(edges(loop)).toEqual(["a→b", "b→c"]);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        {
          field: "steps[1].branches[1]",
          kind: "unsupported",
          message: 'Kiro watch "w" (handler "on-save") is not imported.',
        },
        {
          field: "steps[1].joinPolicy",
          kind: "lossy",
          message: "allSettled imported as all; a failed branch now blocks the join.",
        },
        {
          field: "steps[1]",
          kind: "lossy",
          message:
            "Parallel p has one importable branch; imported as plain sequential steps without a parallel group.",
        },
      ]),
    );
  });

  it("reports the shared round budget on every repeat after the first", () => {
    const { loop, report } = importSteps([
      repeat("a", [step("x")]),
      step("mid"),
      repeat("b", [step("y")]),
    ]);
    expect(loop.groups.map(({ id, kind }) => `${kind}:${id}`)).toEqual(["repeat:a", "repeat:b"]);
    const shared = (field: string) =>
      report.issues.some(
        (candidate) =>
          candidate.field === field && candidate.message.includes("shares that budget"),
      );
    expect(shared("steps[2].maxIterations")).toBe(true);
    expect(shared("steps[0].maxIterations")).toBe(false);
  });

  it("lists template references from prompts and stop conditions", () => {
    const { report } = importSteps([
      repeat("r", [step("a", { prompt: "Do {{task}}." })], {
        stopCondition: {
          fileCheck: { path: ".out/{{run_id}}/done.json", jsonPath: "done", value: true },
        },
      }),
    ]);
    const template = report.issues.find(({ field }) => field === "steps[*].prompt");
    expect(template?.message).toMatch(/: \{\{task\}\}, \{\{run_id\}\}$/);
  });

  it("clamps repeat rounds and preserves long stop conditions", () => {
    const { loop, report } = importSteps([
      repeat("r", [step("a")], { maxIterations: 50, stopWhen: "x".repeat(600) }),
    ]);
    const group = loop.groups[0];
    expect(group?.kind === "repeat" ? group.maxIterations : undefined).toBe(10);
    const atRounds = report.issues.filter(({ field }) => field === "steps[0].maxIterations");
    expect(atRounds.map(({ message }) => message)).toEqual([
      "Clamped from 50 to 10.",
      "Effective rounds are limited by the draft policy (2).",
    ]);
    const stop = JSON.stringify({ stopWhen: "x".repeat(600) }, null, 2);
    expect(stepOf(loop, "a").instruction).toBe("a step.");
    const decision = stepOf(loop, "r-decision").instruction;
    expect(decision.endsWith(`Kiro stop condition (verbatim JSON):\n${stop}`)).toBe(true);
    expect(report.issues.filter(({ field }) => field === "steps[0].stopWhen")).toEqual([
      {
        field: "steps[0].stopWhen",
        kind: "lossy",
        message:
          'Kiro stop condition is not evaluated by Code Factory; importer-generated step "r-decision" asks an agent to evaluate it and return "stop" or "continue".',
      },
    ]);
  });

  it("bounds a stop condition beyond the size limit and reports the cut", () => {
    const text = "y".repeat(maxJsonLength);
    const { loop, report } = importSteps([
      repeat("r", [step("a")], { stopCondition: { containsText: text } }),
    ]);
    const full = JSON.stringify({ stopCondition: { containsText: text } }, null, 2);
    const decision = stepOf(loop, "r-decision").instruction;
    expect(decision.endsWith(`${full.slice(0, maxJsonLength)}…`)).toBe(true);
    expect(report.issues).toContainEqual({
      field: "steps[0].stopCondition",
      kind: "lossy",
      message: `Kiro stop condition is ${full.length} characters as JSON; step "r-decision" keeps only the first ${maxJsonLength}.`,
    });
  });

  it("requires an empty draft", async () => {
    const draft = parseLoop({
      ...blankDraft(),
      steps: [
        {
          id: "existing",
          name: "Existing",
          kind: "agent",
          role: "",
          instruction: "Keep me.",
        },
      ],
    });
    const text = await fixture("ui-delivery-focused.workflow.json");
    expect(failure(() => kiroWorkflowTranslator.import(text, draft))).toContain("empty draft");
  });
});

describe("kiro workflow translator: fan-out and fan-in", () => {
  it("wires the reduced full recipe through consecutive parallels inside the repeat", async () => {
    const { loop, report } = importText(await fixture("ui-delivery-reduced.workflow.json"));
    expect(parseLoop(loop)).toEqual(loop);
    const all = edges(loop);
    expect(all).toEqual(
      expect.arrayContaining([
        "integrate-and-check→code-quality-review",
        "integrate-and-check→react-review",
        "code-quality-review→performance-review",
        "react-review→performance-review",
        "code-quality-review→security-review",
        "react-review→security-review",
        "performance-review→business-review",
        "security-review→business-review",
        "performance-review→test-review",
        "security-review→test-review",
        "business-review→acceptance",
        "test-review→acceptance",
      ]),
    );
    const firstReviewers = ["code-quality-review", "react-review"];
    const secondReviewers = ["performance-review", "security-review"];
    expect(joinsOf(loop)).toEqual([
      { stepId: "acceptance", mode: "all", from: ["business-review", "test-review"] },
      { stepId: "business-review", mode: "all", from: secondReviewers },
      { stepId: "design-plan", mode: "all", from: ["domain-context", "ui-test-context"] },
      { stepId: "performance-review", mode: "all", from: firstReviewers },
      { stepId: "security-review", mode: "all", from: firstReviewers },
      { stepId: "test-review", mode: "all", from: secondReviewers },
    ]);
    expect(loop.groups.filter(({ kind }) => kind === "parallel").map(({ id }) => id)).toEqual([
      "gather-context",
    ]);
    const allSettled = report.issues.filter(({ message }) => message.startsWith("allSettled"));
    expect(allSettled.map(({ field }) => field)).toEqual([
      "steps[3].steps[3].steps[0].joinPolicy",
      "steps[3].steps[3].steps[1].joinPolicy",
      "steps[3].steps[3].steps[2].joinPolicy",
    ]);
  });

  it("wires parallels of sequences, consecutive parallels and a repeat before a parallel", () => {
    const { loop, report } = importSteps([
      step("start"),
      parallel("fan", [
        sequence("s1", [step("a1"), step("a2")]),
        sequence("s2", [step("b1"), step("b2")]),
      ]),
      parallel("pair", [step("c1"), step("c2")]),
      repeat("r", [step("loop-step")]),
      parallel("after", [step("d1"), step("d2")]),
    ]);
    expect(parseLoop(loop)).toEqual(loop);
    expect(edges(loop)).toEqual(
      [
        "start→a1",
        "start→b1",
        "a1→a2",
        "b1→b2",
        "a2→c1",
        "b2→c1",
        "a2→c2",
        "b2→c2",
        "c1→loop-step",
        "c2→loop-step",
        "loop-step→r-decision",
        "r-decision→r-exit",
        "r-exit→d1",
        "r-exit→d2",
      ].sort(),
    );
    expect(joinsOf(loop)).toEqual([
      { stepId: "c1", mode: "all", from: ["a2", "b2"] },
      { stepId: "c2", mode: "all", from: ["a2", "b2"] },
      { stepId: "loop-step", mode: "all", from: ["c1", "c2"] },
    ]);
    expect(loop.groups.map(({ id, kind }) => `${kind}:${id}`)).toEqual([
      "parallel:pair",
      "repeat:r",
      "parallel:after",
    ]);
    const order = loop.steps.map(({ id }) => id);
    expect(order.slice(order.indexOf("loop-step"), order.indexOf("loop-step") + 3)).toEqual([
      "loop-step",
      "r-decision",
      "r-exit",
    ]);
    expect(loop.decisions).toEqual([
      {
        stepId: "r-decision",
        branches: [
          { outcome: "stop", to: "r-exit" },
          { outcome: "continue", to: "loop-step" },
        ],
      },
    ]);
    expect(report.issues).toContainEqual({
      field: "steps[1]",
      kind: "lossy",
      message:
        "Parallel fan imported as fan-out/fan-in dependencies without a parallel group (a branch has several steps).",
    });
  });

  it("rewires joins onto the synthetic exit of a repeat inside a parallel", () => {
    const { loop } = importSteps([
      step("start"),
      parallel("wrap", [repeat("r", [step("loop-step")]), step("side")]),
      parallel("after", [step("d1"), step("d2")]),
    ]);
    expect(parseLoop(loop)).toEqual(loop);
    expect(edges(loop)).toEqual(
      [
        "start→loop-step",
        "start→side",
        "loop-step→r-decision",
        "r-decision→r-exit",
        "r-exit→d1",
        "r-exit→d2",
        "side→d1",
        "side→d2",
      ].sort(),
    );
    expect(joinsOf(loop)).toEqual([
      { stepId: "d1", mode: "all", from: ["r-exit", "side"] },
      { stepId: "d2", mode: "all", from: ["r-exit", "side"] },
    ]);
  });
});
