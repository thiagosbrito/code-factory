import type { LoopDefinition } from "../../../../domain/loop.js";
import { removeDependency } from "../loop-editor-dependencies";
import { connectionError } from "./graph-actions";
import type { Point } from "./graph-layout";

export type LinkTarget = {
  id: string;
  name: string;
  /** Why connecting is not possible (shown beside the name), or null when it is allowed. */
  reason: string | null;
  /** True when the dependency already exists; it is listed but cannot be added again. */
  connected: boolean;
};

/**
 * Every other step as a candidate for a new dependency `from -> target`, in loop order. A refused
 * candidate keeps its reason, taken from a dry run of the same operation the mouse uses, so a
 * keyboard user reads exactly the message a dropped connection would show.
 */
export const linkTargets = (loop: LoopDefinition, from: string): LinkTarget[] =>
  loop.steps
    .filter((step) => step.id !== from)
    .map((step) => {
      const connected = loop.dependencies.some((edge) => edge.from === from && edge.to === step.id);
      return {
        id: step.id,
        name: step.name,
        connected,
        reason: connected ? null : connectionError(loop, from, step.id),
      };
    });

export type StepLink = {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  /** Why removing it is refused (for example a repeat group's exit), or null when it is allowed. */
  reason: string | null;
};

/** A dry run of removeDependency: the readable refusal, or null when the removal is allowed. */
const removalError = (loop: LoopDefinition, from: string, to: string): string | null => {
  try {
    removeDependency(loop, from, to);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/** The dependencies leaving and entering a step, named for a list a person can read. */
export const linksOf = (
  loop: LoopDefinition,
  stepId: string,
): { outgoing: StepLink[]; incoming: StepLink[] } => {
  const name = (id: string) => loop.steps.find((step) => step.id === id)?.name ?? id;
  const link = (from: string, to: string): StepLink => ({
    from,
    to,
    fromName: name(from),
    toName: name(to),
    reason: removalError(loop, from, to),
  });
  return {
    outgoing: loop.dependencies
      .filter((edge) => edge.from === stepId)
      .map((e) => link(e.from, e.to)),
    incoming: loop.dependencies.filter((edge) => edge.to === stepId).map((e) => link(e.from, e.to)),
  };
};

/**
 * The step nearest to `id` in a direction, for moving focus with the keyboard. Only steps on that
 * side qualify; distance along the direction counts once and sideways distance twice, so the card
 * "straight" that way wins over a nearer one far off to the side. Null when nothing lies that way.
 */
export const neighbourInDirection = (
  positions: Map<string, Point>,
  id: string,
  direction: Point,
): string | null => {
  const origin = positions.get(id);
  if (!origin) return null;
  let best: { id: string; score: number } | null = null;
  for (const [other, point] of positions) {
    if (other === id) continue;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const along = dx * direction.x + dy * direction.y;
    if (along <= 0) continue;
    const across = Math.abs(dx * direction.y - dy * direction.x);
    const score = along + 2 * across;
    if (!best || score < best.score) best = { id: other, score };
  }
  return best?.id ?? null;
};
