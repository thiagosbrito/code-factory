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

type LoopShape = z.infer<typeof baseLoopSchema>;
type Group = LoopShape["groups"][number];
type Report = (message: string) => void;

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function validateDependencies(loop: LoopShape, stepIds: Set<string>, report: Report): Set<string> {
  const edges = new Set<string>();
  for (const { from, to } of loop.dependencies) {
    if (!stepIds.has(from) || !stepIds.has(to))
      report("Dependencies must reference existing steps.");
    const key = `${from}:${to}`;
    if (edges.has(key)) report("Dependencies must be unique.");
    edges.add(key);
  }
  return edges;
}

function validateRepeatGroup(
  group: Extract<Group, { kind: "repeat" }>,
  loop: LoopShape,
  report: Report,
): void {
  const decision = loop.decisions.find(({ stepId }) => stepId === group.exitWhen.stepId);
  const exit = decision?.branches.find(({ outcome }) => outcome === group.exitWhen.outcome);
  const continuation = decision?.branches.find(
    ({ outcome, to }) => outcome === group.continueWhen.outcome && to === group.continueWhen.to,
  );
  const validExit =
    group.stepIds.includes(group.exitWhen.stepId) && exit && !group.stepIds.includes(exit.to);
  const validContinuation =
    group.stepIds.includes(group.continueWhen.to) &&
    continuation &&
    group.continueWhen.outcome !== group.exitWhen.outcome;
  if (!validExit) report(`Repeat ${group.id} needs an exit decision leading outside its body.`);
  if (!validContinuation) report(`Repeat ${group.id} needs a distinct continuation into its body.`);
}

function validateGroup(group: Group, loop: LoopShape, stepIds: Set<string>, report: Report): void {
  if (hasDuplicates(group.stepIds)) report(`Group ${group.id} repeats a step.`);
  for (const id of group.stepIds) {
    if (!stepIds.has(id)) report(`Group ${group.id} references missing step ${id}.`);
  }
  if (group.kind === "repeat") return validateRepeatGroup(group, loop, report);
  const ordersMembers = loop.dependencies.some(
    ({ from, to }) => group.stepIds.includes(from) && group.stepIds.includes(to),
  );
  if (ordersMembers) report(`Parallel group ${group.id} cannot order its members.`);
}

function validateGroups(loop: LoopShape, stepIds: Set<string>, report: Report): void {
  const groupIds = new Set<string>();
  for (const group of loop.groups) {
    if (groupIds.has(group.id)) report(`Duplicate group ${group.id}.`);
    groupIds.add(group.id);
    validateGroup(group, loop, stepIds, report);
  }
  for (const step of loop.steps) {
    const containingGroups = loop.groups.filter(({ stepIds: members }) =>
      members.includes(step.id),
    );
    if (step.groupId && !containingGroups.some(({ id }) => id === step.groupId))
      report(`Step ${step.id} has invalid group ${step.groupId}.`);
    if (containingGroups.some(({ id }) => id !== step.groupId))
      report(`Step ${step.id} must identify its containing group.`);
  }
}

function validateJoins(
  loop: LoopShape,
  stepIds: Set<string>,
  edges: Set<string>,
  report: Report,
): void {
  if (hasDuplicates(loop.joins.map(({ stepId }) => stepId))) report("Join steps must be unique.");
  for (const join of loop.joins) {
    if (!stepIds.has(join.stepId)) report(`Join references missing step ${join.stepId}.`);
    if (hasDuplicates(join.from)) report(`Join ${join.stepId} repeats a source.`);
    for (const id of join.from) {
      if (!edges.has(`${id}:${join.stepId}`))
        report(`Join ${join.stepId} needs dependency ${id} -> ${join.stepId}.`);
    }
    const incoming = loop.dependencies.filter(({ to }) => to === join.stepId);
    if (incoming.some(({ from }) => !join.from.includes(from)))
      report(`Join ${join.stepId} omits an incoming dependency.`);
  }
}

function isRepeatContinuation(
  loop: LoopShape,
  stepId: string,
  outcome: string,
  to: string,
): boolean {
  return loop.groups.some(
    (group) =>
      group.kind === "repeat" &&
      group.exitWhen.stepId === stepId &&
      group.continueWhen.outcome === outcome &&
      group.continueWhen.to === to,
  );
}

function validateDecisions(
  loop: LoopShape,
  stepIds: Set<string>,
  edges: Set<string>,
  report: Report,
): void {
  if (hasDuplicates(loop.decisions.map(({ stepId }) => stepId)))
    report("Decision steps must be unique.");
  for (const decision of loop.decisions) {
    if (!stepIds.has(decision.stepId))
      report(`Decision references missing step ${decision.stepId}.`);
    if (hasDuplicates(decision.branches.map(({ outcome }) => outcome)))
      report(`Decision ${decision.stepId} repeats an outcome.`);
    for (const { outcome, to } of decision.branches) {
      if (
        !edges.has(`${decision.stepId}:${to}`) &&
        !isRepeatContinuation(loop, decision.stepId, outcome, to)
      )
        report(`Decision ${decision.stepId} needs dependency to ${to}.`);
    }
    const outgoing = loop.dependencies.filter(({ from }) => from === decision.stepId);
    if (outgoing.some(({ to }) => !decision.branches.some((branch) => branch.to === to)))
      report(`Decision ${decision.stepId} omits an outgoing dependency.`);
  }
}

function validateAcyclic(loop: LoopShape, stepIds: Set<string>, report: Report): void {
  const remaining = new Set(stepIds);
  while (remaining.size) {
    const ready = [...remaining].filter(
      (id) => !loop.dependencies.some(({ from, to }) => to === id && remaining.has(from)),
    );
    if (!ready.length) {
      report("Dependency cycles are not allowed; repairs require explicit bounded policy.");
      return;
    }
    for (const id of ready) remaining.delete(id);
  }
}

export const loopSchema = baseLoopSchema.superRefine((loop, context) => {
  const stepIds = new Set(loop.steps.map(({ id }) => id));
  const report: Report = (message) => context.addIssue({ code: "custom", message });
  if (stepIds.size !== loop.steps.length) report("Step IDs must be unique.");
  if (loop.status === "published" && !loop.steps.length) report("A published loop needs a step.");
  const edges = validateDependencies(loop, stepIds, report);
  validateGroups(loop, stepIds, report);
  validateJoins(loop, stepIds, edges, report);
  validateDecisions(loop, stepIds, edges, report);
  validateAcyclic(loop, stepIds, report);
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
