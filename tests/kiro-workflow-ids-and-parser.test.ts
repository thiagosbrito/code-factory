import { describe, expect, it } from "vitest";
import {
  boundedJson,
  humanize,
  inferStage,
  maxJsonLength,
  normalizeId,
  uniqueId,
} from "../src/translators/kiro-workflow-ids.js";
import { formatIssuePath, parseKiroWorkflow } from "../src/translators/kiro-workflow-schema.js";
import { failure, fixture, repeat, step, workflowText } from "./support/kiro-workflow-import.js";

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

const nest = (depth: number): unknown =>
  depth === 1 ? step("leaf") : { type: "sequence", id: `s${depth}`, steps: [nest(depth - 1)] };

const unknownField = (field: string) => ({
  field,
  kind: "unsupported",
  message: "Unknown Kiro field is not imported.",
});

const parseFailure = (content: string) => failure(() => parseKiroWorkflow(content));

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
