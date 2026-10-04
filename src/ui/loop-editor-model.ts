import { parseLoop, type LoopDefinition } from "../domain/loop.js";

export type Stage = "evidence" | "planning" | "implementation" | "review" | "validation";
export const stages: { id: Stage; name: string; description: string }[] = [
  {
    id: "evidence",
    name: "1. Evidence",
    description: "Requirements, discovery, and baseline context",
  },
  { id: "planning", name: "2. Plan", description: "Design decisions and implementation planning" },
  {
    id: "implementation",
    name: "3. Implementation",
    description: "Source changes and candidate preparation",
  },
  {
    id: "review",
    name: "4. Review",
    description: "Quality, accessibility, security, and acceptance",
  },
  { id: "validation", name: "5. Validate", description: "Executable checks and final outcome" },
];
export type EditorStep = LoopDefinition["steps"][number];
export type DropTarget = { stepId: string; placement: "before" | "after" };

export const stageOf = (step: EditorStep): Stage => {
  return step.stage ?? (step.kind === "check" ? "validation" : "implementation");
};
export const addStep = (
  loop: LoopDefinition,
  stage: Stage,
  kind: EditorStep["kind"],
): LoopDefinition => {
  if (kind === "check" && stage !== "validation")
    throw new Error("Check steps belong in Validate.");
  const id = `step-${crypto.randomUUID()}`;
  return parseLoop({
    ...loop,
    steps: [
      ...loop.steps,
      {
        id,
        name: kind === "check" ? "New check" : "New agent step",
        kind,
        stage,
        role: kind === "check" ? "Check" : "Agent",
        instruction: "Describe this step.",
        expectedOutputs: ["Step result"],
      },
    ],
  });
};

/** Coordinates are presentation only; dependencies change solely through explicit semantic targets. */
export const moveVisual = (
  loop: LoopDefinition,
  stepId: string,
  x: number,
  y: number,
): LoopDefinition => {
  return parseLoop({
    ...loop,
    steps: loop.steps.map((step) => (step.id === stepId ? { ...step, position: { x, y } } : step)),
  });
};

export const semanticDrop = (
  loop: LoopDefinition,
  stepId: string,
  target: DropTarget,
): LoopDefinition => {
  if (stepId === target.stepId) return loop;
  const moving = loop.steps.find((step) => step.id === stepId);
  const anchor = loop.steps.find((step) => step.id === target.stepId);
  if (!moving || !anchor) throw new Error("Select two existing steps.");
  if (moving.kind === "check" && stageOf(anchor) !== "validation")
    throw new Error("Check steps belong in Validate.");
  if (
    moving.groupId ||
    anchor.groupId ||
    loop.decisions.some((item) => [stepId, target.stepId].includes(item.stepId)) ||
    loop.joins.some((item) => [stepId, target.stepId].includes(item.stepId))
  )
    throw new Error(
      "This drop crosses a group, join, or decision. Edit its explicit connections instead.",
    );
  const incoming = loop.dependencies.filter((edge) => edge.to === stepId);
  const outgoing = loop.dependencies.filter((edge) => edge.from === stepId);
  if (incoming.length > 1 || outgoing.length > 1)
    throw new Error("Reordering a branch needs explicit connection editing.");
  let edges = loop.dependencies.filter((edge) => edge.from !== stepId && edge.to !== stepId);
  if (incoming[0] && outgoing[0])
    edges = [...edges, { from: incoming[0].from, to: outgoing[0].to }];
  const predecessor =
    target.placement === "before" ? edges.filter((edge) => edge.to === target.stepId) : [];
  const successor =
    target.placement === "after" ? edges.filter((edge) => edge.from === target.stepId) : [];
  if (predecessor.length > 1 || successor.length > 1)
    throw new Error("This target has multiple connections. Edit its join or decision instead.");
  edges = edges.filter((edge) => !predecessor.includes(edge) && !successor.includes(edge));
  const first = target.placement === "before" ? predecessor[0]?.from : target.stepId;
  const last = target.placement === "before" ? target.stepId : successor[0]?.to;
  if (first) edges.push({ from: first, to: stepId });
  if (last) edges.push({ from: stepId, to: last });
  const steps = loop.steps.filter((step) => step.id !== stepId);
  const index = steps.findIndex((step) => step.id === target.stepId);
  steps.splice(index + (target.placement === "after" ? 1 : 0), 0, {
    ...moving,
    stage: stageOf(anchor),
  });
  return parseLoop({ ...loop, steps, dependencies: edges });
};

export const setParallelGroup = (
  loop: LoopDefinition,
  ids: string[],
  name: string,
): LoopDefinition => {
  if (
    ids.length < 2 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !loop.steps.some((step) => step.id === id))
  )
    throw new Error("Select two or more distinct steps for a parallel group.");
  if (loop.steps.some((step) => ids.includes(step.id) && step.groupId))
    throw new Error("A step can belong to one group.");
  const id = `group-${crypto.randomUUID()}`;
  const members = new Set(ids);
  const dependencies = loop.dependencies.filter(
    (edge) => !(members.has(edge.from) && members.has(edge.to)),
  );
  return parseLoop({
    ...loop,
    dependencies,
    groups: [
      ...loop.groups,
      { id, name: name.trim() || "Parallel group", kind: "parallel", stepIds: ids },
    ],
    steps: loop.steps.map((step) => (members.has(step.id) ? { ...step, groupId: id } : step)),
  });
};

export const removeGroup = (loop: LoopDefinition, id: string): LoopDefinition => {
  const group = loop.groups.find((item) => item.id === id);
  return parseLoop({
    ...loop,
    groups: loop.groups.filter((group) => group.id !== id),
    decisions:
      group?.kind === "repeat"
        ? loop.decisions.filter((decision) => decision.stepId !== group.exitWhen.stepId)
        : loop.decisions,
    steps: loop.steps.map((step) => (step.groupId === id ? { ...step, groupId: undefined } : step)),
  });
};

export const assignStepToGroup = (
  loop: LoopDefinition,
  stepId: string,
  groupId: string,
): LoopDefinition => {
  const step = loop.steps.find((item) => item.id === stepId);
  const group = loop.groups.find((item) => item.id === groupId);
  if (!step || !group) throw new Error("Select an existing step and group.");
  if (step.groupId)
    throw new Error("A step can belong to one group. Remove its current group first.");
  const memberIds = new Set([...group.stepIds, stepId]);
  const dependencies =
    group.kind === "parallel"
      ? loop.dependencies.filter((edge) => !(memberIds.has(edge.from) && memberIds.has(edge.to)))
      : loop.dependencies;
  return parseLoop({
    ...loop,
    dependencies,
    groups: loop.groups.map((item) =>
      item.id === groupId ? { ...item, stepIds: [...item.stepIds, stepId] } : item,
    ),
    steps: loop.steps.map((item) => (item.id === stepId ? { ...item, groupId } : item)),
  });
};

export const removeJoin = (loop: LoopDefinition, stepId: string): LoopDefinition => {
  return parseLoop({ ...loop, joins: loop.joins.filter((join) => join.stepId !== stepId) });
};

export const removeDecision = (loop: LoopDefinition, stepId: string): LoopDefinition => {
  if (loop.groups.some((group) => group.kind === "repeat" && group.exitWhen.stepId === stepId))
    throw new Error("Remove the repeat group before its decision.");
  return parseLoop({
    ...loop,
    decisions: loop.decisions.filter((decision) => decision.stepId !== stepId),
  });
};

export const setJoin = (
  loop: LoopDefinition,
  stepId: string,
  from: string[],
  mode: "all" | "any",
): LoopDefinition => {
  if (from.length < 2 || new Set(from).size !== from.length || from.includes(stepId))
    throw new Error("A join needs at least two distinct source steps.");
  const joins = [...loop.joins.filter((join) => join.stepId !== stepId), { stepId, from, mode }];
  const dependencies = [
    ...loop.dependencies.filter((edge) => edge.to !== stepId),
    ...from.map((id) => ({ from: id, to: stepId })),
  ];
  return parseLoop({ ...loop, joins, dependencies });
};

export const setDecision = (
  loop: LoopDefinition,
  stepId: string,
  branches: { outcome: string; to: string }[],
): LoopDefinition => {
  if (branches.length < 2 || branches.some((branch) => !branch.outcome.trim() || !branch.to))
    throw new Error("A decision needs two named branches and targets.");
  const continuation = new Set(
    loop.groups.flatMap((group) =>
      group.kind === "repeat" && group.exitWhen.stepId === stepId
        ? [`${group.continueWhen.outcome}:${group.continueWhen.to}`]
        : [],
    ),
  );
  const dependencies = [
    ...loop.dependencies.filter((edge) => edge.from !== stepId),
    ...branches
      .filter((branch) => !continuation.has(`${branch.outcome}:${branch.to}`))
      .map((branch) => ({ from: stepId, to: branch.to })),
  ];
  return parseLoop({
    ...loop,
    dependencies,
    decisions: [...loop.decisions.filter((item) => item.stepId !== stepId), { stepId, branches }],
  });
};

export const setRepeatGroup = (
  loop: LoopDefinition,
  ids: string[],
  name: string,
  maxIterations: number,
  exitWhen: { stepId: string; outcome: string; to: string },
  continueWhen: { outcome: string; to: string },
): LoopDefinition => {
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10)
    throw new Error("Repeat limit must be between 1 and 10.");
  if (
    ids.some(
      (id) =>
        !loop.steps.some((step) => step.id === id) ||
        loop.steps.find((step) => step.id === id)?.groupId,
    )
  )
    throw new Error("Repeat steps must exist and belong to no other group.");
  const id = `group-${crypto.randomUUID()}`;
  const members = new Set(ids);
  if (
    !members.has(exitWhen.stepId) ||
    members.has(exitWhen.to) ||
    !members.has(continueWhen.to) ||
    exitWhen.outcome === continueWhen.outcome
  )
    throw new Error(
      "Repeat needs an exit outside the group and a distinct continuation inside it.",
    );
  const dependencies = [
    ...loop.dependencies.filter((edge) => edge.from !== exitWhen.stepId),
    { from: exitWhen.stepId, to: exitWhen.to },
  ];
  const decisions = [
    ...loop.decisions.filter((item) => item.stepId !== exitWhen.stepId),
    {
      stepId: exitWhen.stepId,
      branches: [
        { outcome: exitWhen.outcome, to: exitWhen.to },
        { outcome: continueWhen.outcome, to: continueWhen.to },
      ],
    },
  ];
  return parseLoop({
    ...loop,
    dependencies,
    decisions,
    groups: [
      ...loop.groups,
      {
        id,
        name: name.trim() || "Repeat group",
        kind: "repeat",
        stepIds: ids,
        maxIterations,
        exitWhen: { stepId: exitWhen.stepId, outcome: exitWhen.outcome },
        continueWhen,
      },
    ],
    steps: loop.steps.map((step) => (members.has(step.id) ? { ...step, groupId: id } : step)),
  });
};

export const deleteStep = (loop: LoopDefinition, id: string): LoopDefinition => {
  if (loop.steps.some((step) => step.id === id && step.groupId))
    throw new Error("Remove the group before deleting a member.");
  const incoming = loop.dependencies.filter((edge) => edge.to === id);
  const outgoing = loop.dependencies.filter((edge) => edge.from === id);
  if (
    loop.decisions.some(
      (decision) => decision.stepId === id || decision.branches.some((branch) => branch.to === id),
    ) ||
    loop.joins.some((join) => join.stepId === id || join.from.includes(id)) ||
    incoming.length > 1 ||
    outgoing.length > 1
  )
    throw new Error("Remove joins and decisions that reference this step first.");
  return parseLoop({
    ...loop,
    steps: loop.steps.filter((step) => step.id !== id),
    dependencies: [
      ...loop.dependencies.filter((edge) => edge.from !== id && edge.to !== id),
      ...(incoming[0] && outgoing[0] ? [{ from: incoming[0].from, to: outgoing[0].to }] : []),
    ],
  });
};

export type History = { present: LoopDefinition; past: LoopDefinition[]; future: LoopDefinition[] };
export const commit = (history: History, next: LoopDefinition): History => {
  if (JSON.stringify(history.present) === JSON.stringify(next)) return history;
  return { present: next, past: [...history.past, history.present], future: [] };
};
export const undo = (history: History): History => {
  const previous = history.past.at(-1);
  return previous
    ? {
        present: previous,
        past: history.past.slice(0, -1),
        future: [history.present, ...history.future],
      }
    : history;
};
export const redo = (history: History): History => {
  const next = history.future[0];
  return next
    ? { present: next, past: [...history.past, history.present], future: history.future.slice(1) }
    : history;
};
