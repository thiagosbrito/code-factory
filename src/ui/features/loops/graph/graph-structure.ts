import type { LoopDefinition } from "../../../../domain/loop.js";
import { decisionSourceMessage } from "../loop-editor-dependencies";
import type { EditorStep } from "../loop-editor-model";

/**
 * Pure read-only derivations of how groups, joins and decisions appear in the Graph view. Nothing
 * here writes a loop: groups, joins and decisions are edited in the Board view.
 */

type Join = LoopDefinition["joins"][number];
type JoinMode = Join["mode"];

export const BOARD_HINT = "Edit it in the Board view.";

/** The domain's wording for a join mode: "all" waits for every source, "any" for the first. */
export const joinLabel = (mode: JoinMode): string => `waits for ${mode}`;

/** The badges of a step: its group, its join mode and its decision outcomes. */
export const stepBadges = (loop: LoopDefinition, step: EditorStep): string[] => {
  const group = loop.groups.find((item) => item.id === step.groupId);
  const join = loop.joins.find((item) => item.stepId === step.id);
  const decision = loop.decisions.find((item) => item.stepId === step.id);
  return [
    ...(group ? [`${group.kind}: ${group.name}`] : []),
    ...(join ? [joinLabel(join.mode)] : []),
    ...(decision
      ? [`decision: ${decision.branches.map((branch) => branch.outcome).join(" / ")}`]
      : []),
  ];
};

const nameOf = (loop: LoopDefinition, id: string): string =>
  loop.steps.find((step) => step.id === id)?.name ?? id;

/**
 * What the Graph says about a step's structure, for assistive technology and tooltips:
 * `startBlocked` is why a connection cannot begin at this step (null when it can), `note` is a
 * sentence per structure the step belongs to. The refusal text is the model's own message.
 */
export const stepNotes = (
  loop: LoopDefinition,
  step: EditorStep,
): { startBlocked: string | null; note: string } => {
  const group = loop.groups.find((item) => item.id === step.groupId);
  const join = loop.joins.find((item) => item.stepId === step.id);
  const decision = loop.decisions.find((item) => item.stepId === step.id);
  const notes: string[] = [];
  if (group?.kind === "parallel")
    notes.push(
      `Member of parallel group ${group.name}: its members cannot be ordered with each other. ${BOARD_HINT}`,
    );
  if (group?.kind === "repeat")
    notes.push(
      `Member of repeat group ${group.name}, which repeats up to ${group.maxIterations} times. ${BOARD_HINT}`,
    );
  if (join)
    notes.push(
      `Join: ${joinLabel(join.mode)} of ${join.from.map((id) => nameOf(loop, id)).join(", ")}. ${BOARD_HINT}`,
    );
  const startBlocked = decision
    ? `Decision step: add a named branch in the Board view. ${decisionSourceMessage(step.id)}`
    : null;
  if (decision && startBlocked)
    notes.push(
      `Decision with branches ${decision.branches.map((branch) => `${branch.outcome} to ${nameOf(loop, branch.to)}`).join(", ")}. ${startBlocked}`,
    );
  return { startBlocked, note: notes.join(" ") };
};

/**
 * Structure carried by one dependency: the decision outcomes that lead along it and, when its
 * target is a join, that join's mode. A repeat's continuation has no dependency, so it is not here.
 */
export const edgeStructure = (
  loop: LoopDefinition,
  from: string,
  to: string,
): { outcomes: string[]; join: JoinMode | null } => {
  const decision = loop.decisions.find((item) => item.stepId === from);
  const join = loop.joins.find((item) => item.stepId === to && item.from.includes(from));
  const continuationKeys = new Set(
    loop.groups.flatMap((group) =>
      group.kind === "repeat" && group.exitWhen.stepId === from
        ? [`${group.continueWhen.outcome}:${group.continueWhen.to}`]
        : [],
    ),
  );
  return {
    outcomes: (decision?.branches ?? [])
      .filter(
        (branch) => branch.to === to && !continuationKeys.has(`${branch.outcome}:${branch.to}`),
      )
      .map((branch) => branch.outcome),
    join: join?.mode ?? null,
  };
};

export type Continuation = {
  groupId: string;
  from: string;
  to: string;
  label: string;
  description: string;
};

/** Each repeat group's `continueWhen`: the back arrow from its exit decision to the loop's start. */
export const continuations = (loop: LoopDefinition): Continuation[] =>
  loop.groups.flatMap((group) =>
    group.kind === "repeat"
      ? [
          {
            groupId: group.id,
            from: group.exitWhen.stepId,
            to: group.continueWhen.to,
            label: group.continueWhen.outcome,
            description: `Repeat group ${group.name} continues with ${group.continueWhen.outcome} from ${nameOf(loop, group.exitWhen.stepId)} back to ${nameOf(loop, group.continueWhen.to)}, up to ${group.maxIterations} times. View only: ${BOARD_HINT}`,
          },
        ]
      : [],
  );
