import { parseLoop, type LoopDefinition } from "../../../domain/loop.js";
import { stageOf, stages, type Stage } from "./loop-editor-model";

/**
 * The few placement rules the Board shares with the Graph view. They live apart from the Graph's
 * layout and drop planner so the Board, which loads with the main bundle, does not pull the
 * lazily loaded Graph view's code in with it.
 */

export type Point = { x: number; y: number };

export const LANE_WIDTH = 260;
/** The Runs graph draws every node at least 210 x 102; overlap and row spacing use that size. */
export const RUN_NODE_WIDTH = 210;
export const NODE_HEIGHT = 102;
export const ROW_HEIGHT = 120;
export const FIRST_ROW_Y = 48;
export const DEFAULT_OFFSET_X = 16;

export const stageIndex = (stage: Stage): number => stages.findIndex((item) => item.id === stage);

/** The x of a lane's left edge. */
export const laneOriginX = (stage: Stage): number => stageIndex(stage) * LANE_WIDTH;

export const overlaps = (left: Point, right: Point): boolean =>
  Math.abs(left.x - right.x) < RUN_NODE_WIDTH && Math.abs(left.y - right.y) < NODE_HEIGHT;

/** The y of the first row, from the top of a lane, where a node at `x` overlaps none of `others`. */
export const firstFreeRowY = (x: number, others: Point[]): number => {
  let y = FIRST_ROW_Y;
  while (others.some((other) => overlaps({ x, y }, other))) y += ROW_HEIGHT;
  return y;
};

/**
 * Keeps positions all-or-none: when some steps have a stored position and others do not, each
 * step without one is written on the first free row of its lane; a loop with no positions at all
 * (or every position) is returned unchanged. The Runs graph reads a stored position as absolute
 * and lays out the rest on its own grid, so a partly positioned loop would overlap there.
 */
export const completePositions = (loop: LoopDefinition): LoopDefinition => {
  if (!loop.steps.some((step) => step.position) || loop.steps.every((step) => step.position))
    return loop;
  const taken = new Map<Stage, Point[]>();
  const remember = (stage: Stage, point: Point) =>
    taken.set(stage, [...(taken.get(stage) ?? []), point]);
  for (const step of loop.steps) if (step.position) remember(stageOf(step), step.position);
  const placed = new Map<string, Point>();
  for (const step of loop.steps) {
    if (step.position) continue;
    const stage = stageOf(step);
    const x = laneOriginX(stage) + DEFAULT_OFFSET_X;
    const point = { x, y: firstFreeRowY(x, taken.get(stage) ?? []) };
    remember(stage, point);
    placed.set(step.id, point);
  }
  return parseLoop({
    ...loop,
    steps: loop.steps.map((step) => ({ ...step, position: step.position ?? placed.get(step.id) })),
  });
};
