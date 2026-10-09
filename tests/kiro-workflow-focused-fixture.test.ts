import { describe, expect, it } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import { importerGeneratedRole } from "../src/translators/contract.js";
import { edges, fixture, importText, joinsOf, stepOf } from "./support/kiro-workflow-import.js";

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
