import { parseLoop, type LoopDefinition } from "../domain/loop.js";
import type { ConfigurationTranslator, TranslationIssue } from "./contract.js";

const scalar = (value: string): string => JSON.stringify(value);

const parseScalar = (value: string): string => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "string") return parsed;
  } catch {
    // Plain YAML scalars are valid in Cursor rule frontmatter.
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(value)) throw new Error("Invalid Cursor rule scalar.");
  return value;
};

const parseRule = (content: string) => {
  if (content.length > 1_048_576 || content.includes("\0"))
    throw new Error("Cursor rule is too large or contains invalid bytes.");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
  if (!match) throw new Error("Cursor rule requires YAML frontmatter and a Markdown body.");
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    const key = field?.[1];
    const value = field?.[2];
    if (!key || value === undefined || fields.has(key))
      throw new Error("Malformed or duplicate Cursor rule field.");
    fields.set(key, value);
  }
  const alwaysApply = fields.get("alwaysApply");
  if (alwaysApply !== undefined && alwaysApply !== "true" && alwaysApply !== "false")
    throw new Error("Cursor alwaysApply must be a boolean.");
  for (const [field, value] of fields) {
    if (field === "alwaysApply" || field === "description") continue;
    if (field === "globs" && value.startsWith("[")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new Error("Invalid Cursor rule globs.");
      }
      if (!Array.isArray(parsed) || !parsed.every((glob) => typeof glob === "string"))
        throw new Error("Invalid Cursor rule globs.");
      continue;
    }
    if (field === "globs" && /^[A-Za-z0-9*?{}!,./_-]+$/.test(value)) continue;
    parseScalar(value);
  }
  const description = fields.get("description");
  if (description === undefined) throw new Error("Cursor rule description is required.");
  if (!match[2]?.trim()) throw new Error("Cursor rule body is empty.");
  const parsedDescription = parseScalar(description);
  if (!parsedDescription.trim()) throw new Error("Cursor rule description is empty.");
  return { fields, description: parsedDescription, body: match[2] };
};

export const cursorRuleTranslator: ConfigurationTranslator = {
  format: "cursor-rule-mdc",
  provider: "cursor",
  label: "Cursor project rule (.mdc)",
  relativeDirectory: ".cursor/rules",
  extension: ".mdc",
  import: (content, draft) => {
    if (
      draft.steps.length ||
      draft.dependencies.length ||
      draft.groups.length ||
      draft.joins.length ||
      draft.decisions.length
    )
      throw new Error("Import requires an empty draft to preserve existing steps.");
    const rule = parseRule(content);
    const issues: TranslationIssue[] = [];
    for (const field of rule.fields.keys()) {
      if (field !== "description")
        issues.push({
          field,
          kind: "unsupported",
          message: `Cursor ${field} has no portable loop equivalent.`,
        });
    }
    issues.push({
      field: "ruleActivation",
      kind: "lossy",
      message: "Cursor rule activation is not portable loop scheduling.",
    });
    const loop = parseLoop({
      ...draft,
      name: rule.description,
      steps: [
        {
          id: "imported-rule",
          name: rule.description,
          kind: "agent",
          role: "",
          instruction: rule.body,
          expectedOutputs: [],
        },
      ],
    });
    return { loop, report: { issues } };
  },
  export: (input) => {
    const loop: LoopDefinition = parseLoop(input);
    if (!loop.steps.length) throw new Error("Add an agent step before exporting a Cursor rule.");
    const step = loop.steps[0];
    if (!step) throw new Error("Add an agent step before exporting a Cursor rule.");
    if (step.kind !== "agent") throw new Error("The first step must be an agent step.");
    if (!step.instruction.trim()) throw new Error("The first step needs instructions.");
    const issues: TranslationIssue[] = [];
    if (loop.name !== step.name)
      issues.push({
        field: "name",
        kind: "lossy",
        message: "The loop name differs from the exported step name.",
      });
    for (const field of ["id", "version", "steps[0].id"])
      issues.push({
        field,
        kind: "lossy",
        message: `${field} has no Cursor rule equivalent.`,
      });
    for (const field of [
      "steps",
      "dependencies",
      "groups",
      "joins",
      "decisions",
      "policy",
    ] as const) {
      if (
        (field === "steps" && loop.steps.length > 1) ||
        (field !== "steps" && field !== "policy" && loop[field].length > 0) ||
        (field === "policy" &&
          (loop.policy.maxAttemptsPerStep !== 3 || loop.policy.maxImplementationRounds !== 2))
      )
        issues.push({
          field,
          kind: "lossy",
          message: `${field} cannot be represented by a Cursor rule.`,
        });
    }
    for (const field of [
      "role",
      "binding",
      "expectedOutputs",
      "stage",
      "groupId",
      "position",
    ] as const) {
      if (step[field] && (!Array.isArray(step[field]) || step[field].length))
        issues.push({
          field: `steps[0].${field}`,
          kind: "lossy",
          message: `${field} cannot be represented by a Cursor rule.`,
        });
    }
    issues.push({
      field: "ruleActivation",
      kind: "lossy",
      message: "Exported rule requires explicit Cursor activation settings.",
    });
    return {
      content: `---\ndescription: ${scalar(step.name)}\nalwaysApply: false\n---\n${step.instruction.endsWith("\n") ? step.instruction : `${step.instruction}\n`}`,
      report: { issues },
    };
  },
};
