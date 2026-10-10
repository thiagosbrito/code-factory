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

const stageWarnings = (loop: LoopDefinition, drops: PlannedDrop[]): string[] =>
  drops.flatMap((drop) => {
    const step = loop.steps.find((item) => item.id === drop.id);
    if (!step) return [];
    const from = stageOf(step);
    if (from === drop.stage || (from !== "review" && drop.stage !== "review")) return [];
    return [
      `Moving ${step.name} ${drop.stage === "review" ? "into" : "out of"} the Review lane changes its stage. The scheduler lets review steps run at the same time as each other; every other step runs on its own.`,
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
