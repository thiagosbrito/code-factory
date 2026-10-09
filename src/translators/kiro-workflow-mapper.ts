import { importerGeneratedRole, TranslationError, type TranslationIssue } from "./contract.js";
import { humanize, inferStage, maxJsonLength, normalizeId, uniqueId } from "./kiro-workflow-ids.js";
import {
  formatIssuePath,
  type KiroNode,
  type KiroParallel,
  type KiroRepeat,
  type KiroStep,
  type KiroWorkflow,
} from "./kiro-workflow-schema.js";
import {
  type LoopStep,
  type LoopGroup,
  type LoopDependency,
  type LoopJoin,
  type LoopDecision,
  type LoopPolicy,
  type JoinMode,
  type SourcePath,
  type MappedKiroLoop,
  type Fragment,
  type Context,
  type PendingRepeat,
  maxRepeatIterations,
  templatePattern,
  emptyFragment,
  isEmpty,
  describeStop,
  decisionInstruction,
  exitInstruction,
  stopField,
  modelNote,
} from "./kiro-workflow-mapper-support.js";

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
    // Only a repeat's decision step may continue on a verdict; other reviews reject the run.
    if (context.repeat && stage === "review")
      issue(
        nodeIssues,
        "lossy",
        path,
        `Review step "${id}" is inside Kiro repeat "${context.repeat.rawId}": a "changes-requested" verdict rejects the run instead of starting another round.`,
      );
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
    const firstStep = steps.length;
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
    // The scheduler launches one ready non-review step at a time, and launches ready
    // review steps together only when no non-review step is ready.
    if (steps.slice(firstStep).some(({ stage }) => stage !== "review"))
      issue(
        nodeIssues,
        "lossy",
        path,
        `Parallel ${node.id}: Code Factory starts one non-review step at a time, so these branches run one after another instead of concurrently.`,
      );
    if (mode === "any")
      issue(
        nodeIssues,
        "lossy",
        [...path, "joinPolicy"],
        "any imported as an any join: the next step becomes ready once one branch succeeds, but the other branches are not canceled, and review steps started together are all awaited before another step starts.",
      );
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
  /** Moves every outgoing edge and join input of `from` onto `to`, then links `from → to`. */
  const insertAfter = (from: string, added: LoopStep) => {
    const anchor = stepById.get(from);
    if (!anchor) throw new Error(`Mapped step ${from} is missing.`);
    dependencies = dependencies.map((dependency) =>
      dependency.from === from ? { ...dependency, from: added.id } : dependency,
    );
    for (const join of joins) join.from = join.from.map((id) => (id === from ? added.id : id));
    dependencies.push({ from, to: added.id });
    steps.splice(steps.indexOf(anchor) + 1, 0, added);
    stepById.set(added.id, added);
  };
  pendingRepeats.forEach((pending, index) => {
    const { node, path, groupId, entry, exit } = pending;
    // The last Kiro body step keeps its own prompt and output contract. A dedicated
    // decision step reads its output and returns only "stop" or "continue", because the
    // scheduler fails a decision step whose whole output is not a declared outcome.
    const decision = uniqueId(normalizeId(`${groupId}-decision`), stepIds);
    const stop = describeStop(node);
    insertAfter(exit, {
      id: decision,
      name: `${humanize(node.id)} decision (importer generated)`,
      kind: "agent",
      role: importerGeneratedRole,
      instruction: decisionInstruction(node, exit, stop),
      expectedOutputs: [],
      groupId,
    });
    issue(
      repeatIssues,
      "lossy",
      path,
      `Added importer-generated agent step "${decision}" after "${exit}" to return the repeat decision ("stop" or "continue"). It runs one extra agent turn per round, and on "continue" step "${entry}" receives that outcome instead of the "${exit}" output.`,
    );
    const targets = dependencies.filter(({ from }) => from === decision).map(({ to }) => to);
    let exitTo = targets[0];
    if (targets.length !== 1 || !exitTo) {
      // Repeat groups need a stop target outside the body. Steps are agent turns or host
      // check commands; a pass-through agent turn avoids running anything on the host.
      const synthetic = uniqueId(normalizeId(`${groupId}-exit`), stepIds);
      insertAfter(decision, {
        id: synthetic,
        name: `${humanize(node.id)} exit (importer generated)`,
        kind: "agent",
        role: importerGeneratedRole,
        instruction: exitInstruction(node),
        expectedOutputs: [],
      });
      exitTo = synthetic;
      issue(
        repeatIssues,
        "lossy",
        path,
        `Added importer-generated agent step "${synthetic}" as the exit target required by Code Factory repeat groups. It runs one pass-through agent turn after the repeat stops.`,
      );
    }
    decisions.push({
      stepId: decision,
      branches: [
        { outcome: "stop", to: exitTo },
        { outcome: "continue", to: entry },
      ],
    });
    const maxIterations = Math.min(node.maxIterations, maxRepeatIterations);
    groups.push({
      order: pending.order,
      group: {
        id: groupId,
        name: humanize(node.id),
        kind: "repeat",
        stepIds: [...pending.stepIds, decision],
        maxIterations,
        exitWhen: { stepId: decision, outcome: "stop" },
        continueWhen: { outcome: "continue", to: entry },
      },
    });
    if (stop) stopTexts.push(stop.text);
    issue(
      repeatIssues,
      "lossy",
      stopField(node, path),
      `Kiro stop condition is not evaluated by Code Factory; importer-generated step "${decision}" asks an agent to evaluate it and return "stop" or "continue".`,
    );
    if (stop?.truncated)
      issue(
        repeatIssues,
        "lossy",
        stopField(node, path),
        `Kiro stop condition is ${stop.length} characters as JSON; step "${decision}" keeps only the first ${maxJsonLength}.`,
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
        `Kiro onMaxIterations "${node.onMaxIterations}" has no loop equivalent; Code Factory rejects the run when the round limit is reached instead of ${node.onMaxIterations === "continue" ? "continuing after the repeat" : "pausing"}.`,
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

export type { MappedKiroLoop } from "./kiro-workflow-mapper-support.js";
