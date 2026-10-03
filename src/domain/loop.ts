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
  groupId: identifierSchema.optional(),
  position: z.strictObject({ x: z.number().finite(), y: z.number().finite() }).optional(),
});

const groupSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: identifierSchema,
    name: z.string().trim().min(1),
    kind: z.literal("parallel"),
    stepIds: z.array(identifierSchema).min(2),
  }),
  z.strictObject({
    id: identifierSchema,
    name: z.string().trim().min(1),
    kind: z.literal("repeat"),
    stepIds: z.array(identifierSchema).min(1),
    maxIterations: z.number().int().min(1).max(10),
    exitWhen: z.strictObject({ stepId: identifierSchema, outcome: z.string().trim().min(1) }),
    continueWhen: z.strictObject({ outcome: z.string().trim().min(1), to: identifierSchema }),
  }),
]);

const baseLoopSchema = z.strictObject({
  schemaVersion: z.literal(2),
  id: identifierSchema,
  name: z.string().trim().min(1),
  version: z.number().int().positive(),
  status: z.enum(["draft", "published"]),
  steps: z.array(stepSchema),
  dependencies: z.array(z.strictObject({ from: identifierSchema, to: identifierSchema })),
  groups: z.array(groupSchema).default([]),
  joins: z
    .array(
      z.strictObject({
        stepId: identifierSchema,
        mode: z.enum(["all", "any"]),
        from: z.array(identifierSchema).min(2),
      }),
    )
    .default([]),
  decisions: z
    .array(
      z.strictObject({
        stepId: identifierSchema,
        branches: z
          .array(z.strictObject({ outcome: z.string().trim().min(1), to: identifierSchema }))
          .min(2),
      }),
    )
    .default([]),
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
  const groupIds = new Set<string>();
  for (const group of loop.groups) {
    if (groupIds.has(group.id)) report(`Duplicate group ${group.id}.`);
    groupIds.add(group.id);
    if (new Set(group.stepIds).size !== group.stepIds.length)
      report(`Group ${group.id} repeats a step.`);
    for (const id of group.stepIds)
      if (!stepIds.has(id)) report(`Group ${group.id} references missing step ${id}.`);
    if (
      group.kind === "parallel" &&
      loop.dependencies.some(
        (edge) => group.stepIds.includes(edge.from) && group.stepIds.includes(edge.to),
      )
    )
      report(`Parallel group ${group.id} cannot order its members.`);
    if (group.kind === "repeat") {
      const decision = loop.decisions.find((item) => item.stepId === group.exitWhen.stepId);
      const exit = decision?.branches.find((branch) => branch.outcome === group.exitWhen.outcome);
      const continuation = decision?.branches.find(
        (branch) =>
          branch.outcome === group.continueWhen.outcome && branch.to === group.continueWhen.to,
      );
      if (
        !group.stepIds.includes(group.exitWhen.stepId) ||
        !exit ||
        group.stepIds.includes(exit.to)
      )
        report(`Repeat ${group.id} needs an exit decision leading outside its body.`);
      if (
        !group.stepIds.includes(group.continueWhen.to) ||
        !continuation ||
        group.continueWhen.outcome === group.exitWhen.outcome
      )
        report(`Repeat ${group.id} needs a distinct continuation into its body.`);
    }
  }
  for (const step of loop.steps) {
    if (
      step.groupId &&
      !loop.groups.some((group) => group.id === step.groupId && group.stepIds.includes(step.id))
    )
      report(`Step ${step.id} has invalid group ${step.groupId}.`);
    if (loop.groups.some((group) => group.stepIds.includes(step.id) && step.groupId !== group.id))
      report(`Step ${step.id} must identify its containing group.`);
  }
  if (new Set(loop.joins.map((join) => join.stepId)).size !== loop.joins.length)
    report("Join steps must be unique.");
  for (const join of loop.joins) {
    if (!stepIds.has(join.stepId)) report(`Join references missing step ${join.stepId}.`);
    if (new Set(join.from).size !== join.from.length)
      report(`Join ${join.stepId} repeats a source.`);
    for (const id of join.from)
      if (!edges.has(`${id}:${join.stepId}`))
        report(`Join ${join.stepId} needs dependency ${id} -> ${join.stepId}.`);
    const actual = loop.dependencies
      .filter((edge) => edge.to === join.stepId)
      .map((edge) => edge.from);
    if (actual.some((id) => !join.from.includes(id)))
      report(`Join ${join.stepId} omits an incoming dependency.`);
  }
  if (new Set(loop.decisions.map((decision) => decision.stepId)).size !== loop.decisions.length)
    report("Decision steps must be unique.");
  for (const decision of loop.decisions) {
    if (!stepIds.has(decision.stepId))
      report(`Decision references missing step ${decision.stepId}.`);
    if (
      new Set(decision.branches.map((branch) => branch.outcome)).size !== decision.branches.length
    )
      report(`Decision ${decision.stepId} repeats an outcome.`);
    for (const branch of decision.branches)
      if (
        !edges.has(`${decision.stepId}:${branch.to}`) &&
        !loop.groups.some(
          (group) =>
            group.kind === "repeat" &&
            group.exitWhen.stepId === decision.stepId &&
            group.continueWhen.outcome === branch.outcome &&
            group.continueWhen.to === branch.to,
        )
      )
        report(`Decision ${decision.stepId} needs dependency to ${branch.to}.`);
    const actual = loop.dependencies
      .filter((edge) => edge.from === decision.stepId)
      .map((edge) => edge.to);
    if (actual.some((id) => !decision.branches.some((branch) => branch.to === id)))
      report(`Decision ${decision.stepId} omits an outgoing dependency.`);
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
  return loopSchema.parse(migrateLoop(input));
}

/** V1 had only DAG edges and canvas positions. Migration adds semantic containers without inferring them. */
export function migrateLoop(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input) || !("schemaVersion" in input))
    return input;
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1) return input;
  return { ...value, schemaVersion: 2, groups: [], joins: [], decisions: [] };
}

/** Create a blank draft. Starter templates are an explicit user choice. */
export function createLoopDraft(id: string, name: string): LoopDefinition {
  return parseLoop({
    schemaVersion: 2,
    id,
    name,
    version: 1,
    status: "draft",
    steps: [],
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
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
