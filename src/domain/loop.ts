import { z } from "zod";

export const providerIdSchema = z.enum([
  "mock",
  "codex",
  "cursor",
  "kiro",
  "claude-code",
  "custom",
]);
export type ProviderId = z.infer<typeof providerIdSchema>;
const identifierSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const executionBindingSchema = z.strictObject({
  provider: providerIdSchema,
  model: z.string().trim().min(1).default("agent-default"),
});

const stepSchema = z.strictObject({
  id: identifierSchema,
  name: z.string().trim().min(1),
  kind: z.enum(["agent", "check"]),
  role: z.string().trim().min(1),
  instruction: z.string().trim().min(1),
  binding: executionBindingSchema.optional(),
  expectedOutputs: z.array(z.string().trim().min(1)).default([]),
  position: z.strictObject({ x: z.number().finite(), y: z.number().finite() }).optional(),
});

const baseLoopSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: identifierSchema,
  name: z.string().trim().min(1),
  version: z.number().int().positive(),
  status: z.enum(["draft", "published"]),
  steps: z.array(stepSchema),
  dependencies: z.array(z.strictObject({ from: identifierSchema, to: identifierSchema })),
  policy: z.strictObject({
    maxAttemptsPerStep: z.number().int().min(1).max(10).default(3),
    // Initial implementation counts as round one; this is not a retry count.
    maxImplementationRounds: z.number().int().min(1).max(10).default(2),
  }),
});

export const loopSchema = baseLoopSchema.superRefine((loop, context) => {
  const identifiers = loop.steps.map((step) => step.id);
  const stepIds = new Set(identifiers);
  const report = (message: string) => context.addIssue({ code: "custom", message });
  if (stepIds.size !== identifiers.length) report("Step IDs must be unique.");
  if (loop.status === "published" && !loop.steps.length) report("A published loop needs a step.");
  const edges = new Set<string>();
  for (const edge of loop.dependencies) {
    if (!stepIds.has(edge.from) || !stepIds.has(edge.to))
      report("Dependencies must reference existing steps.");
    const key = `${edge.from}:${edge.to}`;
    if (edges.has(key)) report("Dependencies must be unique.");
    edges.add(key);
  }
  const remaining = new Set(stepIds);
  while (remaining.size) {
    const ready = [...remaining].filter(
      (id) => !loop.dependencies.some((edge) => edge.to === id && remaining.has(edge.from)),
    );
    if (!ready.length) {
      report("Dependency cycles are not allowed; repairs require explicit bounded policy.");
      break;
    }
    for (const id of ready) remaining.delete(id);
  }
});

export type LoopDefinition = z.infer<typeof loopSchema>;
export type ExecutionBinding = z.infer<typeof executionBindingSchema>;

/** Validate untrusted imported loop data before it reaches UI or execution code. */
export function parseLoop(input: unknown): LoopDefinition {
  return loopSchema.parse(input);
}

/** Create a blank draft. Starter templates are an explicit user choice. */
export function createLoopDraft(id: string, name: string): LoopDefinition {
  return parseLoop({
    schemaVersion: 1,
    id,
    name,
    version: 1,
    status: "draft",
    steps: [],
    dependencies: [],
    policy: {},
  });
}

/** Find all results whose inputs are affected by changing a step's output. */
export function getDependentStepIds(loop: LoopDefinition, stepId: string): string[] {
  if (!loop.steps.some((step) => step.id === stepId)) throw new Error(`Unknown step: ${stepId}`);
  const descendants = new Set<string>();
  let frontier = [stepId];
  while (frontier.length) {
    frontier = loop.dependencies
      .filter((edge) => frontier.includes(edge.from) && !descendants.has(edge.to))
      .map((edge) => edge.to);
    for (const id of frontier) descendants.add(id);
  }
  return [...descendants];
}
