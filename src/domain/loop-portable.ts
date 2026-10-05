import { z } from "zod";
import { parseLoop, type LoopDefinition } from "./loop.js";

const envelopeSchema = z.strictObject({
  format: z.literal("code-factory-loop"),
  formatVersion: z.literal(1),
  definition: z.strictObject({
    schemaVersion: z.literal(2),
    name: z.string(),
    steps: z.array(z.unknown()),
    dependencies: z.array(z.unknown()),
    groups: z.array(z.unknown()),
    joins: z.array(z.unknown()),
    decisions: z.array(z.unknown()),
    policy: z.unknown(),
  }),
});

export const exportPortableLoop = (loop: LoopDefinition): string => {
  const { schemaVersion, name, steps, dependencies, groups, joins, decisions, policy } = loop;
  return JSON.stringify(
    {
      format: "code-factory-loop",
      formatVersion: 1,
      definition: { schemaVersion, name, steps, dependencies, groups, joins, decisions, policy },
    },
    null,
    2,
  );
};

export type ImportResult = { loop: LoopDefinition | null; errors: string[] };

export const inspectPortableLoop = (json: string, id: string): ImportResult => {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch (cause) {
    return {
      loop: null,
      errors: [`JSON: ${cause instanceof Error ? cause.message : String(cause)}`],
    };
  }
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) {
    return {
      loop: null,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "document"}: ${issue.message}`,
      ),
    };
  }
  try {
    return {
      loop: parseLoop({ ...parsed.data.definition, id, version: 1, status: "draft" }),
      errors: [],
    };
  } catch (cause) {
    if (cause instanceof z.ZodError)
      return {
        loop: null,
        errors: cause.issues.map(
          (issue) =>
            `definition${issue.path.length ? `.${issue.path.join(".")}` : ""}: ${issue.message}`,
        ),
      };
    return { loop: null, errors: [String(cause)] };
  }
};
