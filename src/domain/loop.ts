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
  effort: z.string().trim().min(1).optional(),
});

const stepSchema = z.strictObject({
  id: identifierSchema,
  name: z.string(),
  kind: z.enum(["agent", "check"]),
  stage: z.enum(["evidence", "planning", "implementation", "review", "validation"]).optional(),
  role: z.string(),
  instruction: z.string(),
  binding: executionBindingSchema.optional(),
  expectedOutputs: z.array(z.string()).default([]),
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
  name: z.string(),
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
type DependencyIndex = {
  edges: Set<string>;
  incoming: Map<string, Set<string>>;
  outgoing: Map<string, Set<string>>;
};

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function validateDependencies(
  loop: LoopShape,
  stepIds: Set<string>,
  report: Report,
): DependencyIndex {
  const index: DependencyIndex = {
    edges: new Set(),
    incoming: new Map(),
    outgoing: new Map(),
  };
  for (const { from, to } of loop.dependencies) {
    if (!stepIds.has(from) || !stepIds.has(to))
      report("Dependencies must reference existing steps.");
    const key = `${from}:${to}`;
    if (index.edges.has(key)) report("Dependencies must be unique.");
    index.edges.add(key);
    const incoming = index.incoming.get(to) ?? new Set<string>();
    incoming.add(from);
    index.incoming.set(to, incoming);
    const outgoing = index.outgoing.get(from) ?? new Set<string>();
    outgoing.add(to);
    index.outgoing.set(from, outgoing);
  }
  return index;
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

function validateGroup(group: Group, loop: LoopShape, report: Report): void {
  if (hasDuplicates(group.stepIds)) report(`Group ${group.id} repeats a step.`);
  if (group.kind === "repeat") validateRepeatGroup(group, loop, report);
}

function validateGroups(loop: LoopShape, stepIds: Set<string>, report: Report): void {
  if (hasDuplicates(loop.groups.map(({ id }) => id))) report("Group IDs must be unique.");
  loop.groups.forEach((group) => validateGroup(group, loop, report));
  const groupById = new Map(loop.groups.map((group) => [group.id, group]));
  const members = loop.groups.flatMap(({ id, stepIds }) =>
    stepIds.map((stepId) => ({ groupId: id, stepId })),
  );
  const declaredGroupByStep = new Map(loop.steps.map(({ id, groupId }) => [id, groupId]));
  const containingGroupByStep = new Map<string, string>();
  for (const { groupId, stepId } of members) {
    if (!stepIds.has(stepId)) report(`Group ${groupId} references missing step ${stepId}.`);
    if (declaredGroupByStep.get(stepId) !== groupId)
      report(`Step ${stepId} must identify its containing group.`);
    containingGroupByStep.set(stepId, groupId);
  }
  for (const step of loop.steps) {
    if (step.groupId && containingGroupByStep.get(step.id) !== step.groupId)
      report(`Step ${step.id} has invalid group ${step.groupId}.`);
  }
  for (const { from, to } of loop.dependencies) {
    const groupId = containingGroupByStep.get(from);
    if (
      groupId &&
      groupId === containingGroupByStep.get(to) &&
      groupById.get(groupId)?.kind === "parallel"
    )
      report(`Parallel group ${groupId} cannot order its members.`);
  }
}

function validateJoins(
  loop: LoopShape,
  stepIds: Set<string>,
  dependencies: DependencyIndex,
  report: Report,
): void {
  if (hasDuplicates(loop.joins.map(({ stepId }) => stepId))) report("Join steps must be unique.");
  for (const join of loop.joins) {
    if (!stepIds.has(join.stepId)) report(`Join references missing step ${join.stepId}.`);
    if (hasDuplicates(join.from)) report(`Join ${join.stepId} repeats a source.`);
    const incoming = dependencies.incoming.get(join.stepId) ?? new Set<string>();
    const missing = join.from.find((id) => !incoming.has(id));
    if (missing) report(`Join ${join.stepId} needs dependency ${missing} -> ${join.stepId}.`);
    const declared = new Set(join.from);
    if ([...incoming].some((id) => !declared.has(id)))
      report(`Join ${join.stepId} omits an incoming dependency.`);
  }
}

function validateDecisions(
  loop: LoopShape,
  stepIds: Set<string>,
  dependencies: DependencyIndex,
  report: Report,
): void {
  if (hasDuplicates(loop.decisions.map(({ stepId }) => stepId)))
    report("Decision steps must be unique.");
  const continuations = new Set(
    loop.groups.flatMap((group) =>
      group.kind === "repeat"
        ? [`${group.exitWhen.stepId}:${group.continueWhen.outcome}:${group.continueWhen.to}`]
        : [],
    ),
  );
  for (const decision of loop.decisions) {
    if (!stepIds.has(decision.stepId))
      report(`Decision references missing step ${decision.stepId}.`);
    if (hasDuplicates(decision.branches.map(({ outcome }) => outcome)))
      report(`Decision ${decision.stepId} repeats an outcome.`);
    for (const { outcome, to } of decision.branches) {
      if (
        !dependencies.edges.has(`${decision.stepId}:${to}`) &&
        !continuations.has(`${decision.stepId}:${outcome}:${to}`)
      )
        report(`Decision ${decision.stepId} needs dependency to ${to}.`);
    }
    const targets = new Set(decision.branches.map(({ to }) => to));
    const outgoing = dependencies.outgoing.get(decision.stepId) ?? new Set<string>();
    if ([...outgoing].some((to) => !targets.has(to)))
      report(`Decision ${decision.stepId} omits an outgoing dependency.`);
  }
}

function validateAcyclic(
  stepIds: Set<string>,
  dependencies: DependencyIndex,
  report: Report,
): void {
  const pending = new Map(
    [...stepIds].map((id) => [
      id,
      [...(dependencies.incoming.get(id) ?? [])].filter((source) => stepIds.has(source)).length,
    ]),
  );
  const ready = [...pending].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length) {
    const id = ready.pop();
    if (id === undefined) break;
    visited++;
    for (const successor of dependencies.outgoing.get(id) ?? []) {
      const count = pending.get(successor);
      if (count === undefined) continue;
      pending.set(successor, count - 1);
      if (count === 1) ready.push(successor);
    }
  }
  if (visited !== stepIds.size)
    report("Dependency cycles are not allowed; repairs require explicit bounded policy.");
}

export const loopSchema = baseLoopSchema.superRefine((loop, context) => {
  const stepIds = new Set(loop.steps.map(({ id }) => id));
  const report: Report = (message) => context.addIssue({ code: "custom", message });
  if (stepIds.size !== loop.steps.length) report("Step IDs must be unique.");
  if (loop.status === "published" && !loop.steps.length) report("A published loop needs a step.");
  if (loop.status === "published") {
    if (!loop.name.trim()) report("A published loop needs a title.");
    for (const step of loop.steps) {
      if (!step.name.trim()) report(`Step ${step.id} needs a title.`);
      if (!step.role.trim()) report(`Step ${step.id} needs a role.`);
      if (!step.instruction.trim()) report(`Step ${step.id} needs instructions.`);
    }
  }
  const dependencies = validateDependencies(loop, stepIds, report);
  validateGroups(loop, stepIds, report);
  validateJoins(loop, stepIds, dependencies, report);
  validateDecisions(loop, stepIds, dependencies, report);
  validateAcyclic(stepIds, dependencies, report);
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
