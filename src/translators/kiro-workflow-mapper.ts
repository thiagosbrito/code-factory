import type { LoopDefinition } from "../domain/loop.js";
import { TranslationError, type TranslationIssue } from "./contract.js";
import { humanize, inferStage, normalizeId, truncateJson, uniqueId } from "./kiro-workflow-ids.js";
import {
  formatIssuePath,
  type KiroNode,
  type KiroParallel,
  type KiroRepeat,
  type KiroStep,
  type KiroWorkflow,
} from "./kiro-workflow-schema.js";

type LoopStep = LoopDefinition["steps"][number];
type LoopGroup = LoopDefinition["groups"][number];
type LoopDependency = LoopDefinition["dependencies"][number];
type LoopJoin = LoopDefinition["joins"][number];
type LoopDecision = LoopDefinition["decisions"][number];
type LoopPolicy = LoopDefinition["policy"];
type JoinMode = LoopJoin["mode"];
type SourcePath = readonly PropertyKey[];

export type MappedKiroLoop = {
  name: string;
  steps: LoopStep[];
  dependencies: LoopDependency[];
  groups: LoopGroup[];
  joins: LoopJoin[];
  decisions: LoopDecision[];
};

/** Entry and exit step ids of a mapped Kiro node; empty when nothing was importable. */
type Fragment = { entries: string[]; exits: string[]; exitMode?: JoinMode; exitPath?: SourcePath };
type Context = { repeat?: { groupId: string; rawId: string } };
type PendingRepeat = {
  node: KiroRepeat;
  path: SourcePath;
  groupId: string;
  order: number;
  stepIds: string[];
  entry: string;
  exit: string;
};

const maxRepeatIterations = 10;
const templatePattern = /\{\{[^{}]+\}\}/g;
const emptyFragment = (): Fragment => ({ entries: [], exits: [] });
const isEmpty = (fragment: Fragment): boolean => fragment.entries.length === 0;

const describeStop = (node: KiroRepeat): string => {
  if (node.stopCondition) return truncateJson(node.stopCondition);
  if (node.stopWhen !== undefined) return truncateJson({ stopWhen: node.stopWhen });
  return "none (repeat until the round limit)";
};

const stopField = (node: KiroRepeat, path: SourcePath): SourcePath => {
  if (node.stopCondition) return [...path, "stopCondition"];
  if (node.stopWhen !== undefined) return [...path, "stopWhen"];
  return path;
};

const modelNote = (step: KiroStep, workflow: KiroWorkflow): string => {
  const part = (label: string, own: string | undefined, inherited: string | undefined) => {
    const value = own ?? inherited;
    if (value === undefined) return undefined;
    return `${label} "${value}"${own === undefined ? " (workflow default)" : ""}`;
  };
  const model = part("Kiro model", step.modelId, workflow.modelId);
  const effort = part(model ? "effort" : "Kiro effort", step.effortLevel, workflow.effortLevel);
  const parts = [model, effort].filter((value) => value !== undefined);
  if (!parts.length) return "";
  return `\n\n---\nCode Factory import note: ${parts.join(", ")} (not bound; choose a binding in the editor).`;
};

/**
 * Pure, deterministic mapping from a parsed Kiro workflow to V2 loop fields.
 * Builder state below is local to one call; steps are mutated only while wiring.
 */
export const mapKiroWorkflow = (
  workflow: KiroWorkflow,
  policy: LoopPolicy,
): { loop: MappedKiroLoop; issues: TranslationIssue[] } => {
  const rootIssues: TranslationIssue[] = [];
  const nodeIssues: TranslationIssue[] = [];
  const repeatIssues: TranslationIssue[] = [];
  const issue = (
    target: TranslationIssue[],
    kind: TranslationIssue["kind"],
    path: SourcePath,
    message: string,
  ) => target.push({ field: formatIssuePath(path), kind, message });

  const steps: LoopStep[] = [];
  const stepById = new Map<string, LoopStep>();
  const sourcePathByStep = new Map<string, SourcePath>();
  let dependencies: LoopDependency[] = [];
  const joins: LoopJoin[] = [];
  const decisions: LoopDecision[] = [];
  const groups: { order: number; group: LoopGroup }[] = [];
  const pendingRepeats: PendingRepeat[] = [];
  const rawIds = new Set<string>();
  const stepIds = new Set<string>();
  const groupIds = new Set<string>();
  const prompts: string[] = [];
  let preorder = 0;

  const reserve = (raw: string, taken: Set<string>, path: SourcePath): string => {
    const id = uniqueId(normalizeId(raw), taken);
    if (id !== raw)
      issue(nodeIssues, "lossy", [...path, "id"], `Kiro id "${raw}" imported as "${id}"`);
    return id;
  };

  const connect = (previous: Fragment, next: Fragment) => {
    for (const entry of next.entries) {
      for (const exit of previous.exits) dependencies.push({ from: exit, to: entry });
      if (previous.exits.length >= 2)
        joins.push({ stepId: entry, mode: previous.exitMode ?? "all", from: [...previous.exits] });
    }
  };

  const mapStep = (node: KiroStep, path: SourcePath, context: Context): Fragment => {
    const id = reserve(node.id, stepIds, path);
    const stage = inferStage(node.agent, node.id);
    const step: LoopStep = {
      id,
      name: humanize(node.id),
      kind: "agent",
      role: node.agent,
      instruction: `${node.prompt}${modelNote(node, workflow)}`,
      expectedOutputs: [],
      ...(stage ? { stage } : {}),
      ...(context.repeat ? { groupId: context.repeat.groupId } : {}),
    };
    steps.push(step);
    stepById.set(id, step);
    sourcePathByStep.set(id, path);
    prompts.push(node.prompt);
    const unsupported = (key: string, message: string) =>
      issue(nodeIssues, "unsupported", [...path, key], message);
    unsupported(
      "agent",
      `Kiro agent "${node.agent}" kept as role text; no execution binding inferred.`,
    );
    if (node.modelId !== undefined)
      unsupported(
        "modelId",
        `Kiro model "${node.modelId}" has no portable binding; kept as an instruction note.`,
      );
    if (node.effortLevel !== undefined)
      unsupported(
        "effortLevel",
        `Kiro effort "${node.effortLevel}" has no portable binding; kept as an instruction note.`,
      );
    if (node.artifacts !== undefined)
      unsupported(
        "artifacts",
        `Kiro artifacts ${Object.keys(node.artifacts).join(", ")} are not declared loop outputs.`,
      );
    if (node.captureOutput === true)
      unsupported("captureOutput", "Kiro output capture has no loop equivalent.");
    if (node.completion !== undefined)
      unsupported("completion", "Kiro completion settings are not imported.");
    return { entries: [id], exits: [id] };
  };

  const mapSequence = (nodes: KiroNode[], path: SourcePath, context: Context): Fragment => {
    const fragments = nodes
      .map((node, index) => mapNode(node, [...path, index], context))
      .filter((fragment) => !isEmpty(fragment));
    const first = fragments[0];
    const last = fragments.at(-1);
    if (!first || !last) return emptyFragment();
    fragments.slice(1).forEach((fragment, index) => {
      const previous = fragments[index];
      if (previous) connect(previous, fragment);
    });
    return { ...last, entries: first.entries };
  };

  const mapParallel = (
    node: KiroParallel,
    path: SourcePath,
    context: Context,
    order: number,
  ): Fragment => {
    const branches = node.branches
      .map((branch, index) => ({
        branch,
        fragment: mapNode(branch, [...path, "branches", index], context),
      }))
      .filter(({ fragment }) => !isEmpty(fragment));
    const only = branches[0];
    if (!only) return emptyFragment();
    const mode: JoinMode = node.joinPolicy === "any" ? "any" : "all";
    const directSteps = branches.every(({ branch }) => branch.type === "step");
    const groupId =
      branches.length >= 2 && directSteps && !context.repeat
        ? reserve(node.id, groupIds, path)
        : undefined;
    if (node.joinPolicy === "allSettled")
      issue(
        nodeIssues,
        "lossy",
        [...path, "joinPolicy"],
        "allSettled imported as all; a failed branch now blocks the join.",
      );
    if (branches.length === 1) {
      issue(
        nodeIssues,
        "lossy",
        path,
        `Parallel ${node.id} has one importable branch; imported as plain sequential steps without a parallel group.`,
      );
      return only.fragment;
    }
    for (const { fragment } of branches) {
      if (fragment.exits.length >= 2 && (fragment.exitMode ?? "all") !== mode)
        issue(
          nodeIssues,
          "lossy",
          [...(fragment.exitPath ?? path), "joinPolicy"],
          `Nested join policy merged into enclosing parallel ${node.id} (${mode}).`,
        );
    }
    const entries = branches.flatMap(({ fragment }) => fragment.entries);
    if (groupId) {
      for (const id of entries) {
        const member = stepById.get(id);
        if (member) member.groupId = groupId;
      }
      groups.push({
        order,
        group: { id: groupId, name: humanize(node.id), kind: "parallel", stepIds: entries },
      });
    } else {
      const reason = context.repeat
        ? `inside repeat ${context.repeat.rawId}`
        : "a branch has several steps";
      issue(
        nodeIssues,
        "lossy",
        path,
        `Parallel ${node.id} imported as fan-out/fan-in dependencies without a parallel group (${reason}).`,
      );
    }
    return {
      entries,
      exits: branches.flatMap(({ fragment }) => fragment.exits),
      exitMode: mode,
      exitPath: path,
    };
  };

  const mapRepeat = (
    node: KiroRepeat,
    path: SourcePath,
    context: Context,
    order: number,
  ): Fragment => {
    if (context.repeat)
      throw new TranslationError(
        `${formatIssuePath(path)}: nested Kiro repeats cannot be represented.`,
      );
    // The id issue belongs to the container, so it is emitted after its descendants.
    const ownIssues: TranslationIssue[] = [];
    const groupId = uniqueId(normalizeId(node.id), groupIds);
    if (groupId !== node.id)
      issue(ownIssues, "lossy", [...path, "id"], `Kiro id "${node.id}" imported as "${groupId}"`);
    const firstStep = steps.length;
    const body = mapSequence(node.steps, [...path, "steps"], {
      repeat: { groupId, rawId: node.id },
    });
    nodeIssues.push(...ownIssues);
    const where = formatIssuePath(path);
    if (isEmpty(body))
      throw new TranslationError(`${where}: repeat ${node.id} has no importable steps.`);
    const [entry] = body.entries;
    if (body.entries.length !== 1 || !entry)
      throw new TranslationError(`${where}: repeat ${node.id} must start with a single step.`);
    const [exit] = body.exits;
    if (body.exits.length !== 1 || !exit)
      throw new TranslationError(
        `${where}: repeat ${node.id} must end with a single step that can carry its stop decision.`,
      );
    pendingRepeats.push({
      node,
      path,
      groupId,
      order,
      stepIds: steps.slice(firstStep).map(({ id }) => id),
      entry,
      exit,
    });
    return body;
  };

  const mapNode = (node: KiroNode, path: SourcePath, context: Context): Fragment => {
    const order = preorder++;
    if (rawIds.has(node.id))
      throw new TranslationError(`${formatIssuePath(path)}.id: duplicate Kiro id "${node.id}"`);
    rawIds.add(node.id);
    switch (node.type) {
      case "step":
        return mapStep(node, path, context);
      case "watch":
        issue(
          nodeIssues,
          "unsupported",
          path,
          `Kiro watch "${node.id}" (handler "${node.handler}") is not imported.`,
        );
        return emptyFragment();
      case "sequence":
        return mapSequence(node.steps, [...path, "steps"], context);
      case "parallel":
        return mapParallel(node, path, context, order);
      case "repeat":
        return mapRepeat(node, path, context, order);
    }
  };

  if (workflow.description !== undefined)
    issue(
      rootIssues,
      "unsupported",
      ["description"],
      "Kiro workflow description is not imported; loops have no description field.",
    );
  const inputNames = Object.keys(workflow.inputs);
  if (inputNames.length)
    issue(
      rootIssues,
      "unsupported",
      ["inputs"],
      `Kiro workflow inputs ${inputNames.join(", ")} are not imported; loops have no run inputs.`,
    );
  if (workflow.modelId !== undefined)
    issue(
      rootIssues,
      "unsupported",
      ["modelId"],
      `Kiro workflow default model "${workflow.modelId}" has no portable binding; kept in step instruction notes.`,
    );
  if (workflow.effortLevel !== undefined)
    issue(
      rootIssues,
      "unsupported",
      ["effortLevel"],
      `Kiro workflow default effort "${workflow.effortLevel}" has no portable binding; kept in step instruction notes.`,
    );

  const root = mapSequence(workflow.steps, ["steps"], {});
  if (isEmpty(root)) throw new TranslationError("Kiro workflow has no importable steps.");

  const stopTexts: string[] = [];
  pendingRepeats.forEach((pending, index) => {
    const { node, path, groupId, entry, exit } = pending;
    const exitStep = stepById.get(exit);
    if (!exitStep) throw new Error(`Mapped repeat exit ${exit} is missing.`);
    const targets = dependencies.filter(({ from }) => from === exit).map(({ to }) => to);
    let exitTo = targets[0];
    if (targets.length !== 1 || !exitTo) {
      const synthetic = uniqueId(normalizeId(`${groupId}-exit`), stepIds);
      const syntheticStep: LoopStep = {
        id: synthetic,
        name: `${humanize(node.id)} exit`,
        kind: "agent",
        role: "Repeat exit",
        instruction: `Imported from Kiro repeat "${node.id}". Kiro has no step here; summarize the accepted round and record that the repeat stopped.`,
        expectedOutputs: [],
      };
      dependencies = dependencies.map((dependency) =>
        dependency.from === exit ? { ...dependency, from: synthetic } : dependency,
      );
      for (const join of joins) join.from = join.from.map((id) => (id === exit ? synthetic : id));
      dependencies.push({ from: exit, to: synthetic });
      steps.splice(steps.indexOf(exitStep) + 1, 0, syntheticStep);
      stepById.set(synthetic, syntheticStep);
      exitTo = synthetic;
      issue(
        repeatIssues,
        "lossy",
        path,
        `Added step "${synthetic}" as the exit target required by Code Factory repeat groups.`,
      );
    }
    decisions.push({
      stepId: exit,
      branches: [
        { outcome: "stop", to: exitTo },
        { outcome: "continue", to: entry },
      ],
    });
    if (exitStep.stage === "review") {
      delete exitStep.stage;
      issue(
        repeatIssues,
        "lossy",
        sourcePathByStep.get(exit) ?? path,
        `Step "${exit}" carries the repeat decision, so its review stage was not imported.`,
      );
    }
    const maxIterations = Math.min(node.maxIterations, maxRepeatIterations);
    groups.push({
      order: pending.order,
      group: {
        id: groupId,
        name: humanize(node.id),
        kind: "repeat",
        stepIds: pending.stepIds,
        maxIterations,
        exitWhen: { stepId: exit, outcome: "stop" },
        continueWhen: { outcome: "continue", to: entry },
      },
    });
    const stop = describeStop(node);
    stopTexts.push(stop);
    exitStep.instruction += `\n\n---\nCode Factory import note: this step decides Kiro repeat "${node.id}". Return outcome "stop" when the stop condition holds, otherwise "continue".\nKiro stop condition: ${stop}`;
    issue(
      repeatIssues,
      "lossy",
      stopField(node, path),
      `Kiro stop condition ${stop} is not evaluated by Code Factory; step "${exit}" must return "stop" or "continue".`,
    );
    const rounds: SourcePath = [...path, "maxIterations"];
    if (node.maxIterations > maxRepeatIterations)
      issue(
        repeatIssues,
        "lossy",
        rounds,
        `Clamped from ${node.maxIterations} to ${maxRepeatIterations}.`,
      );
    if (maxIterations > policy.maxImplementationRounds)
      issue(
        repeatIssues,
        "lossy",
        rounds,
        `Effective rounds are limited by the draft policy (${policy.maxImplementationRounds}).`,
      );
    if (index > 0)
      issue(
        repeatIssues,
        "lossy",
        rounds,
        `Code Factory counts implementation rounds across all repeat groups (policy limit ${policy.maxImplementationRounds}); this repeat shares that budget with earlier repeats.`,
      );
    const onMax: SourcePath = [...path, "onMaxIterations"];
    if (node.onMaxIterations === "abort")
      issue(
        repeatIssues,
        "lossy",
        onMax,
        "Code Factory rejects the run when the round limit is reached.",
      );
    else
      issue(
        repeatIssues,
        "unsupported",
        onMax,
        `Kiro onMaxIterations "${node.onMaxIterations}" has no loop equivalent.`,
      );
  });

  const refs = [
    ...new Set([...prompts, ...stopTexts].flatMap((text) => text.match(templatePattern) ?? [])),
  ];
  const templateIssues: TranslationIssue[] = refs.length
    ? [
        {
          field: "steps[*].prompt",
          kind: "lossy",
          message: `Kiro template references are kept verbatim and not substituted: ${refs.join(", ")}`,
        },
      ]
    : [];

  return {
    loop: {
      name: workflow.name,
      steps,
      dependencies,
      groups: [...groups].sort((a, b) => a.order - b.order).map(({ group }) => group),
      joins,
      decisions,
    },
    issues: [...rootIssues, ...nodeIssues, ...repeatIssues, ...templateIssues],
  };
};
