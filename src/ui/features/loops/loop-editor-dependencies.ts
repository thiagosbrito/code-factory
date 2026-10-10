import { ZodError } from "zod";
import { parseLoop, type LoopDefinition } from "../../../domain/loop.js";
import { stageOf, type Stage } from "./loop-editor-model.js";

/**
 * Pure dependency and stage operations for the Graph view. Like the other model functions they
 * return a new validated loop or throw an Error with a readable message; a throw leaves the
 * caller's loop and its undo history untouched (`commit` only ever receives a successful result).
 * `continueWhen` is not a dependency: nothing here creates or removes it.
 */

const cycleMessage = "Dependency cycles are not allowed; repairs require explicit bounded policy.";

/** Run parseLoop and turn Zod issues into one readable Error instead of a raw ZodError. */
const parseEdited = (input: unknown): LoopDefinition => {
  try {
    return parseLoop(input);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    throw new Error([...new Set(error.issues.map((issue) => issue.message))].join(" "));
  }
};

const requireSteps = (loop: LoopDefinition, ids: string[]): void => {
  if (ids.some((id) => !loop.steps.some((step) => step.id === id)))
    throw new Error("Select two existing steps.");
};

export const addDependency = (loop: LoopDefinition, from: string, to: string): LoopDefinition => {
  requireSteps(loop, [from, to]);
  if (from === to) throw new Error(cycleMessage);
  if (loop.dependencies.some((edge) => edge.from === from && edge.to === to))
    throw new Error(`Step ${from} already leads to step ${to}.`);
  // A decision owns its outgoing edges: a plain edge would be an unnamed branch. Adding a branch
  // needs an outcome name, so it goes through setDecision rather than being guessed here.
  if (loop.decisions.some((decision) => decision.stepId === from))
    throw new Error(
      `Step ${from} is a decision. Add a named branch to its decision instead of a plain connection.`,
    );
  return parseEdited({
    ...loop,
    dependencies: [...loop.dependencies, { from, to }],
    // A join must list exactly its incoming edges, so its source list grows in the same parse.
    joins: loop.joins.map((join) =>
      join.stepId === to ? { ...join, from: [...join.from, from] } : join,
    ),
  });
};

export const removeDependency = (
  loop: LoopDefinition,
  from: string,
  to: string,
): LoopDefinition => {
  if (!loop.dependencies.some((edge) => edge.from === from && edge.to === to))
    throw new Error(`Step ${from} does not lead to step ${to}.`);
  const dependencies = loop.dependencies.filter((edge) => !(edge.from === from && edge.to === to));
  // Safest choice for a decision: it needs two named branches, so removing a branch that would
  // leave fewer is refused. The user must remove the decision explicitly (removeDecision), which
  // never happens as a side effect of deleting a connection. Repeat exit decisions fall under the
  // same rule because they always hold the exit and the continuation branch.
  const continuations = new Set(
    loop.groups.flatMap((group) =>
      group.kind === "repeat" && group.exitWhen.stepId === from
        ? [`${group.continueWhen.outcome}:${group.continueWhen.to}`]
        : [],
    ),
  );
  const decisions = loop.decisions.map((decision) => {
    if (decision.stepId !== from) return decision;
    const branches = decision.branches.filter(
      (branch) => branch.to !== to || continuations.has(`${branch.outcome}:${branch.to}`),
    );
    if (branches.length < 2)
      throw new Error(
        `Decision ${from} needs at least two branches. Remove the decision first to disconnect this step.`,
      );
    return { ...decision, branches };
  });
  // A join with fewer than two sources is no longer a join: the record is dropped and the
  // remaining plain edge stays.
  const joins = loop.joins.flatMap((join) => {
    if (join.stepId !== to) return [join];
    const sources = join.from.filter((source) => source !== from);
    return sources.length < 2 ? [] : [{ ...join, from: sources }];
  });
  return parseEdited({ ...loop, dependencies, decisions, joins });
};

/** Changes only `stage`; edges, order and positions are untouched (unlike semanticDrop). */
export const setStage = (loop: LoopDefinition, stepId: string, stage: Stage): LoopDefinition => {
  const step = loop.steps.find((item) => item.id === stepId);
  if (!step) throw new Error("Select an existing step.");
  if (
    step.groupId ||
    loop.decisions.some((item) => item.stepId === stepId) ||
    loop.joins.some((item) => item.stepId === stepId)
  )
    throw new Error(
      "This step belongs to a group, join, or decision. Edit its explicit connections instead.",
    );
  if (step.kind === "check" && stage !== "validation")
    throw new Error("Check steps belong in Validate.");
  if (stageOf(step) === stage) return loop;
  return parseEdited({
    ...loop,
    steps: loop.steps.map((item) => (item.id === stepId ? { ...item, stage } : item)),
  });
};
