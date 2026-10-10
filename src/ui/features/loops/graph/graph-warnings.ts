import type { LoopDefinition } from "../../../../domain/loop.js";
import { removeDependency } from "../loop-editor-dependencies";
import { stageOf } from "../loop-editor-model";
import { dropAction, type PlannedDrop } from "./graph-actions";
import { joinLabel } from "./graph-structure";

/**
 * Warnings for changes the model accepts but that lose or alter something the user may not expect.
 * A change the model would refuse has no warning here: running it reports the refusal instead.
 * Connecting needs no warning: addDependency keeps joins consistent and loses nothing.
 */
export type ProposedChange =
  | { kind: "disconnect"; edges: { source: string; target: string }[] }
  | { kind: "drop"; drops: PlannedDrop[] };

const nameOf = (loop: LoopDefinition, id: string): string =>
  loop.steps.find((step) => step.id === id)?.name ?? id;

/** What one successful removal dropped: a join falling below two sources, several decision outcomes. */
const removalWarnings = (
  before: LoopDefinition,
  after: LoopDefinition,
  edge: { source: string; target: string },
): string[] => {
  const warnings: string[] = [];
  const source = nameOf(before, edge.source);
  const target = nameOf(before, edge.target);
  const join = before.joins.find((item) => item.stepId === edge.target);
  if (join && !after.joins.some((item) => item.stepId === edge.target))
    warnings.push(
      `Removing the connection from ${source} to ${target} leaves join ${target} with fewer than two sources, so the join (${joinLabel(join.mode)}) is removed.${
        join.mode === "any"
          ? " Connecting them again gives a plain fan-in that waits for all, not for any."
          : ""
      }`,
    );
  const decision = before.decisions.find((item) => item.stepId === edge.source);
  const kept = after.decisions.find((item) => item.stepId === edge.source);
  const lost = (decision?.branches ?? []).filter(
    (branch) => !kept?.branches.some((other) => other.outcome === branch.outcome),
  );
  if (lost.length > 1)
    warnings.push(
      `Removing the connection from ${source} to ${target} removes ${lost.length} decision outcomes that share it: ${lost.map((branch) => branch.outcome).join(", ")}.`,
    );
  return warnings;
};

/** Review and Validate steps receive the results of every upstream step on the same candidate. */
const receivesUpstream = (stage: ReturnType<typeof stageOf>): boolean =>
  stage === "review" || stage === "validation";

/**
 * True when the step has an ancestor that is not a direct dependency. The scheduler always gives a
 * step its direct dependencies' results; a review or validation step additionally gets those of
 * every further-upstream step, so only such a step's inputs depend on its lane.
 */
const hasIndirectAncestor = (loop: LoopDefinition, stepId: string): boolean => {
  const direct = new Set(loop.dependencies.filter((edge) => edge.to === stepId).map((e) => e.from));
  const seen = new Set<string>();
  const queue = [...direct];
  while (queue.length) {
    const id = queue.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    for (const edge of loop.dependencies) if (edge.to === id) queue.push(edge.from);
  }
  return [...seen].some((id) => !direct.has(id));
};

const UPSTREAM_GAIN =
  " It also receives the results of every upstream step on the same candidate, not only its direct dependencies.";
const UPSTREAM_LOSS =
  " It also stops receiving the results of every upstream step on the same candidate; it gets only its direct dependencies.";

const stageWarnings = (loop: LoopDefinition, drops: PlannedDrop[]): string[] =>
  drops.flatMap((drop) => {
    const step = loop.steps.find((item) => item.id === drop.id);
    if (!step) return [];
    const from = stageOf(step);
    if (from === drop.stage) return [];
    // The lane only changes the step's inputs when it has ancestors beyond its direct dependencies.
    const inputsDiffer = hasIndirectAncestor(loop, step.id);
    const gains = inputsDiffer && !receivesUpstream(from) && receivesUpstream(drop.stage);
    const loses = inputsDiffer && receivesUpstream(from) && !receivesUpstream(drop.stage);
    // Check steps are locked to Validate (stageOf maps an unstaged check there), so they never differ.
    if (from !== "review" && drop.stage !== "review") {
      // Validate is not Review, but the scheduler feeds its steps the same upstream results.
      if (gains)
        return [
          `Moving ${step.name} into the Validate lane changes what it receives.${UPSTREAM_GAIN}`,
        ];
      if (loses)
        return [
          `Moving ${step.name} out of the Validate lane changes what it receives.${UPSTREAM_LOSS}`,
        ];
      return [];
    }
    const into = drop.stage === "review";
    return [
      into
        ? `Moving ${step.name} into the Review lane makes it a review step: it only reads the workspace and may run alongside other reviews, and a changes-requested outcome ends the run as rejected unless a repeat group continues it on that outcome.${gains ? UPSTREAM_GAIN : ""}`
        : `Moving ${step.name} out of the Review lane stops it being a review step: it may write to the workspace, so it runs on its own, and a changes-requested outcome no longer rejects the run.${loses ? UPSTREAM_LOSS : ""}`,
    ];
  });

export const changeWarnings = (loop: LoopDefinition, change: ProposedChange): string[] => {
  try {
    if (change.kind === "drop") {
      dropAction(change.drops)(loop);
      return stageWarnings(loop, change.drops);
    }
    let current = loop;
    const warnings: string[] = [];
    for (const edge of change.edges) {
      const next = removeDependency(current, edge.source, edge.target);
      warnings.push(...removalWarnings(current, next, edge));
      current = next;
    }
    return warnings;
  } catch {
    return [];
  }
};
