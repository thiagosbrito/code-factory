import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createLoopDraft, parseLoop, type LoopDefinition } from "../src/domain/loop.js";
import { importerGeneratedRole, TranslationError } from "../src/translators/contract.js";
import { kiroWorkflowTranslator } from "../src/translators/kiro-workflow.js";
import {
  boundedJson,
  humanize,
  inferStage,
  maxJsonLength,
  normalizeId,
  uniqueId,
} from "../src/translators/kiro-workflow-ids.js";
import { formatIssuePath, parseKiroWorkflow } from "../src/translators/kiro-workflow-schema.js";

describe("kiro workflow ids", () => {
  it("normalizes Kiro ids into loop identifiers", () => {
    expect(normalizeId("Design Plan!")).toBe("design-plan");
    expect(normalizeId("1st-step")).toBe("k-1st-step");
    expect(normalizeId("!!!")).toBe("step");
    const long = normalizeId(`${"a".repeat(63)}-b`);
    expect(long).toBe("a".repeat(63));
    expect(long).toMatch(/^[a-z][a-z0-9-]{0,63}$/);
  });

  it("reserves collision-free ids within 64 characters", () => {
    const taken = new Set<string>();
    expect(uniqueId("review", taken)).toBe("review");
    expect(uniqueId("review", taken)).toBe("review-2");
    expect(uniqueId("review", taken)).toBe("review-3");
    const base = "b".repeat(64);
    expect(uniqueId(base, taken)).toBe(base);
    const suffixed = uniqueId(base, taken);
    expect(suffixed).toBe(`${"b".repeat(62)}-2`);
    expect(suffixed).toHaveLength(64);
    expect(taken.has(suffixed)).toBe(true);
  });

  it("humanizes ids", () => {
    expect(humanize("design-plan")).toBe("Design plan");
    expect(humanize("UI_test.context")).toBe("Ui test context");
  });

  it("infers stages from whole tokens only", () => {
    expect(inferStage("ui-react-reviewer", "react-review")).toBe("review");
    expect(inferStage("economy-reader", "domain-context")).toBe("evidence");
    expect(inferStage("wf-coder", "design-plan")).toBe("planning");
    expect(inferStage("wf-coder", "integrate-and-check")).toBe("implementation");
    expect(inferStage("wf-coder", "preview-build")).toBeUndefined();
    expect(inferStage("wf-coder", "planet")).toBeUndefined();
  });

  it("keeps JSON whole up to the limit and truncates beyond it", () => {
    const exact = "x".repeat(maxJsonLength - 2);
    expect(boundedJson(exact)).toEqual({
      text: `"${exact}"`,
      length: maxJsonLength,
      truncated: false,
    });
    const over = "x".repeat(maxJsonLength - 1);
    const bounded = boundedJson(over);
    expect(bounded.text).toBe(`"${over}…`);
    expect(bounded.text).toHaveLength(maxJsonLength + 1);
    expect(bounded).toMatchObject({ length: maxJsonLength + 1, truncated: true });
    expect(boundedJson({ a: [1] }).text).toBe('{\n  "a": [\n    1\n  ]\n}');
  });
});

const fixture = (name: string) =>
  readFile(new URL(`./fixtures/kiro/${name}`, import.meta.url), "utf8");
const step = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "step",
  id,
  agent: "wf-coder",
  prompt: `${id} step.`,
  ...extra,
});
const workflowText = (steps: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "Inline", inputs: {}, steps, ...extra });
const nest = (depth: number): unknown =>
  depth === 1 ? step("leaf") : { type: "sequence", id: `s${depth}`, steps: [nest(depth - 1)] };
const unknownField = (field: string) => ({
  field,
  kind: "unsupported",
  message: "Unknown Kiro field is not imported.",
});
const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected a TranslationError.");
};
/** Returns the message of the TranslationError thrown by `run`. */
const failure = (run: () => unknown): string => {
  const error = thrownBy(run);
  expect(error).toBeInstanceOf(TranslationError);
  return error instanceof Error ? error.message : String(error);
};
const parseFailure = (content: string) => failure(() => parseKiroWorkflow(content));
const repeat = (id: string, steps: unknown[], extra: Record<string, unknown> = {}) => ({
  type: "repeat",
  id,
  maxIterations: 2,
  onMaxIterations: "abort",
  steps,
  ...extra,
});

describe("kiro workflow boundary parser", () => {
  it("formats issue paths", () => {
    expect(formatIssuePath(["steps", 3, "branches", 0, "prompt"])).toBe(
      "steps[3].branches[0].prompt",
    );
    expect(formatIssuePath([])).toBe("workflow");
  });

  it("rejects invalid bytes and invalid JSON", () => {
    expect(parseFailure(`${workflowText([step("a")])}\0`)).toContain("invalid bytes");
    expect(parseFailure("{ nope")).toContain("not valid JSON");
  });

  it("rejects schema violations with source paths", () => {
    expect(parseFailure(workflowText([step("a"), { type: "bogus", id: "b" }]))).toContain(
      'steps[1].type: unknown Kiro node type "bogus"',
    );
    expect(parseFailure(workflowText([{ type: "step", id: "a", agent: "x" }]))).toContain(
      "steps[0].prompt",
    );
    expect(parseFailure(JSON.stringify({ name: "No inputs", steps: [step("a")] }))).toContain(
      "inputs",
    );
    expect(parseFailure(workflowText([repeat("r", [step("a")], { maxIterations: 0 })]))).toContain(
      "steps[0].maxIterations",
    );
    expect(
      parseFailure(
        workflowText([{ type: "parallel", id: "p", joinPolicy: "race", branches: [step("a")] }]),
      ),
    ).toContain("steps[0].joinPolicy");
    expect(
      parseFailure(
        workflowText([
          repeat("r", [step("a")], { stopCondition: { containsText: "done" }, stopWhen: "done" }),
        ]),
      ),
    ).toContain("steps[0].stopWhen: use either stopCondition or stopWhen, not both");
    expect(
      parseFailure(
        workflowText([
          repeat("r", [step("a")], {
            stopCondition: { fileCheck: { path: "a.json", jsonPath: "v", value: 1, extra: true } },
          }),
        ]),
      ),
    ).toContain("steps[0].stopCondition.fileCheck");
  });

  it("limits nesting depth and node count", () => {
    expect(parseKiroWorkflow(workflowText([nest(16)])).workflow.steps).toHaveLength(1);
    expect(parseFailure(workflowText([nest(17)]))).toContain("nesting exceeds 16 levels");
    const many = Array.from({ length: 501 }, (_, index) => step(`s${index}`));
    expect(parseFailure(workflowText(many))).toContain("more than 500 nodes");
  });

  it("rejects deep or oversized free-form values with a TranslationError", () => {
    // Built as text so the fixture itself never recurses: 20,000 nested objects.
    const deep = `${'{"a":'.repeat(20_000)}1${"}".repeat(20_000)}`;
    const withValue = (node: string) =>
      `{"name":"Deep","inputs":{},"steps":[${node.replace("DEEP", deep)}]}`;
    const repeatWith = (field: string) =>
      `{"type":"repeat","id":"r","maxIterations":2,"onMaxIterations":"abort","steps":[{"type":"step","id":"a","agent":"x","prompt":"p"}],"${field}":DEEP}`;
    expect(parseFailure(withValue(repeatWith("stopWhen")))).toMatch(
      /^steps\[0\]\.stopWhen\.a\.a.*: Kiro workflow value nesting exceeds 64 levels\.$/,
    );
    expect(parseFailure(withValue(repeatWith("stopCondition")))).toContain(
      "Kiro workflow value nesting exceeds 64 levels.",
    );
    for (const field of ["completion", "artifacts"])
      expect(
        parseFailure(
          withValue(`{"type":"step","id":"a","agent":"x","prompt":"p","${field}":DEEP}`),
        ),
      ).toContain(`steps[0].${field}.a`);
    expect(
      parseFailure(withValue('{"type":"watch","id":"w","handler":"h","config":DEEP}')),
    ).toContain("steps[0].config.a");
    expect(parseFailure(withValue('{"type":DEEP,"id":"t"}'))).toContain("steps[0].type.a");
    const wide = JSON.stringify(Array.from({ length: 20_001 }, () => 0));
    expect(
      parseFailure(
        withValue(`{"type":"step","id":"a","agent":"x","prompt":"p","completion":${wide}}`),
      ),
    ).toContain("more than 20000 JSON values");
    const shallow = repeat("r", [step("a")], { stopWhen: { all: [{ file: "x", equals: 1 }] } });
    expect(parseKiroWorkflow(workflowText([shallow])).workflow.steps).toHaveLength(1);
  });

  it("names a missing node type instead of printing undefined", () => {
    expect(parseFailure(workflowText([{ id: "a", agent: "x", prompt: "p" }]))).toContain(
      "steps[0].type: missing Kiro node type; expected step, sequence, parallel, repeat or watch",
    );
  });

  it("reports unknown root and node keys instead of failing", () => {
    const { issues } = parseKiroWorkflow(workflowText([step("a", { retries: 3 })], { version: 2 }));
    expect(issues).toEqual([unknownField("version"), unknownField("steps[0].retries")]);
  });

  it("parses both sanitized fixtures without unknown-field issues", async () => {
    const focused = parseKiroWorkflow(await fixture("ui-delivery-focused.workflow.json"));
    expect(
      focused.issues.filter(({ message }) => message.startsWith("Unknown Kiro field")),
    ).toEqual([]);
    expect(focused.workflow.steps).toHaveLength(4);
    const reduced = parseKiroWorkflow(await fixture("ui-delivery-reduced.workflow.json"));
    expect(reduced.issues).toEqual([]);
    expect(reduced.workflow.steps).toHaveLength(4);
  });

  it("does not descend into unknown keys", () => {
    const { issues } = parseKiroWorkflow(workflowText([step("a", { steps: [{ type: "bogus" }] })]));
    expect(issues).toEqual([unknownField("steps[0].steps")]);
  });
});

const blankDraft = () => createLoopDraft("native", "Native");
const importText = (content: string) => kiroWorkflowTranslator.import(content, blankDraft());
const importSteps = (steps: unknown[], extra: Record<string, unknown> = {}) =>
  importText(workflowText(steps, extra));
const importFailure = (steps: unknown[]) => failure(() => importSteps(steps));
const edges = (loop: LoopDefinition) =>
  loop.dependencies.map(({ from, to }) => `${from}→${to}`).sort();
const joinsOf = (loop: LoopDefinition) =>
  [...loop.joins].sort((a, b) => a.stepId.localeCompare(b.stepId));
const stepOf = (loop: LoopDefinition, id: string) => {
  const found = loop.steps.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing step ${id}`);
  return found;
};
const parallel = (id: string, branches: unknown[], joinPolicy = "all") => ({
  type: "parallel",
  id,
  joinPolicy,
  branches,
});
const sequence = (id: string, steps: unknown[]) => ({ type: "sequence", id, steps });
const watch = (id: string) => ({ type: "watch", id, handler: "on-save" });

describe("kiro workflow translator: focused fixture", () => {
  it("maps the focused recipe into a valid loop with a reviewed report", async () => {
    const text = await fixture("ui-delivery-focused.workflow.json");
    const { loop, report } = importText(text);
    expect(parseLoop(loop)).toEqual(loop);
    expect(loop.name).toBe("UI delivery focused (fixture)");
    expect(loop.steps.map(({ id }) => id)).toEqual([
      "prepare",
      "domain-context",
      "ui-test-context",
      "design-plan",
      "implement-and-prepare",
      "generate-candidate",
      "integrate-and-check",
      "react-review",
      "business-review",
      "test-review",
      "acceptance",
      "delivery-rounds-decision",
      "delivery-rounds-exit",
    ]);
    expect(edges(loop)).toEqual(
      [
        "prepare→domain-context",
        "prepare→ui-test-context",
        "domain-context→design-plan",
        "ui-test-context→design-plan",
        "design-plan→implement-and-prepare",
        "implement-and-prepare→generate-candidate",
        "generate-candidate→integrate-and-check",
        "integrate-and-check→react-review",
        "integrate-and-check→business-review",
        "react-review→test-review",
        "business-review→test-review",
        "test-review→acceptance",
        "acceptance→delivery-rounds-decision",
        "delivery-rounds-decision→delivery-rounds-exit",
      ].sort(),
    );
    expect(loop.groups).toEqual([
      {
        id: "gather-context",
        name: "Gather context",
        kind: "parallel",
        stepIds: ["domain-context", "ui-test-context"],
      },
      {
        id: "delivery-rounds",
        name: "Delivery rounds",
        kind: "repeat",
        stepIds: [
          "implement-and-prepare",
          "generate-candidate",
          "integrate-and-check",
          "react-review",
          "business-review",
          "test-review",
          "acceptance",
          "delivery-rounds-decision",
        ],
        maxIterations: 2,
        exitWhen: { stepId: "delivery-rounds-decision", outcome: "stop" },
        continueWhen: { outcome: "continue", to: "implement-and-prepare" },
      },
    ]);
    expect(joinsOf(loop)).toEqual([
      { stepId: "design-plan", mode: "all", from: ["domain-context", "ui-test-context"] },
      { stepId: "test-review", mode: "all", from: ["react-review", "business-review"] },
    ]);
    expect(loop.decisions).toEqual([
      {
        stepId: "delivery-rounds-decision",
        branches: [
          { outcome: "stop", to: "delivery-rounds-exit" },
          { outcome: "continue", to: "implement-and-prepare" },
        ],
      },
    ]);
    expect(Object.fromEntries(loop.steps.map(({ id, stage }) => [id, stage]))).toEqual({
      prepare: undefined,
      "domain-context": "evidence",
      "ui-test-context": "evidence",
      "design-plan": "planning",
      "implement-and-prepare": "implementation",
      "generate-candidate": undefined,
      "integrate-and-check": "implementation",
      "react-review": "review",
      "business-review": "review",
      "test-review": "review",
      acceptance: undefined,
      "delivery-rounds-decision": undefined,
      "delivery-rounds-exit": undefined,
    });
    expect(loop.steps.every((candidate) => candidate.binding === undefined)).toBe(true);
    expect(loop.steps.every(({ kind }) => kind === "agent")).toBe(true);
    expect(stepOf(loop, "react-review").role).toBe("ui-react-reviewer");
    expect(stepOf(loop, "generate-candidate").role).toBe("economy-writer");
    expect(stepOf(loop, "delivery-rounds-decision")).toMatchObject({
      name: "Delivery rounds decision (importer generated)",
      role: importerGeneratedRole,
      groupId: "delivery-rounds",
    });
    expect(stepOf(loop, "delivery-rounds-exit")).toMatchObject({
      name: "Delivery rounds exit (importer generated)",
      role: importerGeneratedRole,
    });
    expect(stepOf(loop, "delivery-rounds-exit").groupId).toBeUndefined();
    expect(loop.steps.filter(({ role }) => role === importerGeneratedRole)).toHaveLength(2);
    const prompt = (id: string) => {
      if (id === "prepare") return "Prepare {{task}}.";
      if (id === "acceptance") return "Accept the round. Previous: {{previous.output}}.";
      return `${id} step. Context: {{prepare.output}}.`;
    };
    for (const { id, instruction } of loop.steps.slice(0, -2))
      expect(instruction.startsWith(prompt(id))).toBe(true);
    expect(stepOf(loop, "prepare").instruction).toMatch(
      /Code Factory import note: Kiro model "claude-opus-5\.5", effort "medium" \(not bound; choose a binding in the editor\)\.$/,
    );
    // The Kiro acceptance step keeps its own prompt and output contract unchanged.
    expect(stepOf(loop, "acceptance").instruction).toBe(
      `${prompt("acceptance")}\n\n---\nCode Factory import note: Kiro model "claude-opus-5.5", effort "high" (not bound; choose a binding in the editor).`,
    );
    const decision = stepOf(loop, "delivery-rounds-decision").instruction;
    expect(decision).toContain('Read the output of step "acceptance"');
    expect(decision).toContain('"stop" when the condition holds, otherwise "continue"');
    expect(decision).toContain(
      `Kiro stop condition (verbatim JSON):\n${JSON.stringify(
        {
          stopCondition: {
            fileCheck: {
              path: ".kiro-artifacts/orchestration/{{run_id}}/acceptance.json",
              jsonPath: "verdict",
              value: "PASS",
            },
          },
        },
        null,
        2,
      )}`,
    );
    expect(stepOf(loop, "delivery-rounds-exit").instruction).toContain(
      "Importer-generated pass-through step",
    );

    const issues = report.issues;
    const has = (field: string, kind: "lossy" | "unsupported") =>
      expect(issues).toContainEqual(expect.objectContaining({ field, kind }));
    has("steps[3].steps[3].steps[0].joinPolicy", "lossy");
    has("steps[3].steps[3].steps[0]", "lossy");
    has("steps[0].agent", "unsupported");
    has("steps[0].modelId", "unsupported");
    has("steps[0].effortLevel", "unsupported");
    has("steps[0].artifacts", "unsupported");
    has("steps[0].captureOutput", "unsupported");
    has("description", "unsupported");
    has("inputs", "unsupported");
    has("steps[3].stopCondition", "lossy");
    has("steps[3]", "lossy");
    has("steps[3].onMaxIterations", "lossy");
    const messageAt = (field: string, start: string) =>
      issues.filter((item) => item.field === field && item.message.startsWith(start));
    const added = 'Added importer-generated agent step "delivery-rounds-';
    expect(messageAt("steps[3]", `${added}decision"`)).toHaveLength(1);
    expect(messageAt("steps[3]", `${added}exit"`)).toHaveLength(1);
    expect(messageAt("steps[1]", "Parallel gather-context: Code Factory starts one")).toHaveLength(
      1,
    );
    // Every review inside the repeat is reported; the all-review parallel is not serialized.
    const rejectingReviews = issues.filter(({ message }) =>
      message.includes('"changes-requested" verdict rejects the run'),
    );
    expect(rejectingReviews).toHaveLength(3);
    expect(
      messageAt("steps[3].steps[3].steps[0]", "Parallel react-business-reviews: Code Factory"),
    ).toEqual([]);
    const templates = issues.filter(({ field }) => field === "steps[*].prompt");
    expect(templates).toHaveLength(1);
    expect(templates[0]?.kind).toBe("lossy");
    expect(templates[0]?.message).toMatch(
      /\{\{task\}\}, \{\{prepare\.output\}\}, \{\{previous\.output\}\}, \{\{run_id\}\}$/,
    );
    expect(issues.some(({ message }) => message.includes("shares that budget"))).toBe(false);
    expect(issues.some(({ message }) => message.startsWith("Unknown Kiro field"))).toBe(false);
    expect(issues[0]?.field).toBe("description");
    expect(issues.at(-1)).toBe(templates[0]);

    expect(importText(text)).toEqual({ loop, report });
  });
});

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
