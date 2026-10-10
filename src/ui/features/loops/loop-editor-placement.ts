import { parseLoop, type LoopDefinition } from "../../../domain/loop.js";
import { stageOf, stages, type Stage } from "./loop-editor-model";

export type Point = { x: number; y: number };

export const LANE_WIDTH = 260;
/** The editor draws every card at least 210 wide by NODE_HEIGHT; overlap and row spacing use that size. */
export const RUN_NODE_WIDTH = 210;
export const NODE_HEIGHT = 132;
export const ROW_HEIGHT = 152;
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
 * The placement rules the Board and the Graph view share, so a position the Board writes is the
 * one the Graph draws. They live apart from the Graph's drop planner so the Board, which loads
 * with the main bundle, does not pull the lazily loaded Graph view's code in with it.
 *
 * Every coordinate is an ABSOLUTE canvas coordinate, the same space the Runs graph reads from
 * `step.position`. A "lane offset" is the distance from a lane's left edge; it exists only inside
 * these helpers and is never stored.
 */

/** The visible lane is a little narrower than its slot so neighbouring lanes show a gutter. */
export const LANE_DRAWN_WIDTH = LANE_WIDTH - 16;
export const NODE_WIDTH = 200;
export const MIN_LANE_HEIGHT = 520;
export const LANE_PADDING = 8;
const LANE_HEADER_HEIGHT = 40;

export const toAbsoluteX = (stage: Stage, offsetX: number): number => laneOriginX(stage) + offsetX;

/** Longest-path rank from a root; edges to unknown steps and cycles cannot hang the loop. */
export const ranksOf = (loop: LoopDefinition): Map<string, number> => {
  const rank = new Map(loop.steps.map((step) => [step.id, 0]));
  for (let pass = 0; pass < loop.steps.length; pass += 1) {
    let changed = false;
    for (const { from, to } of loop.dependencies) {
      const next = (rank.get(from) ?? 0) + 1;
      if (rank.has(to) && next > (rank.get(to) ?? 0)) {
        rank.set(to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rank;
};

const byId = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const orderedSteps = (loop: LoopDefinition): LoopDefinition["steps"] => {
  const rank = ranksOf(loop);
  return [...loop.steps].sort(
    (left, right) =>
      (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0) || byId(left.id, right.id),
  );
};

/**
 * The deterministic default position of every step: ordered by (rank, id), the n-th step of a
 * lane sits on row n at `y = 48 + row * 120`. A stored position does not change this order.
 */
export const defaultPositions = (loop: LoopDefinition): Map<string, Point> => {
  const ordered = orderedSteps(loop);
  const rows = new Map<Stage, number>();
  const positions = new Map<string, Point>();
  for (const step of ordered) {
    const stage = stageOf(step);
    const row = rows.get(stage) ?? 0;
    rows.set(stage, row + 1);
    positions.set(step.id, {
      x: toAbsoluteX(stage, DEFAULT_OFFSET_X),
      y: FIRST_ROW_Y + row * ROW_HEIGHT,
    });
  }
  return positions;
};

const storedHeight = (loop: LoopDefinition): number =>
  Math.max(
    MIN_LANE_HEIGHT,
    ...loop.steps.flatMap((step) =>
      step.position ? [step.position.y + NODE_HEIGHT + FIRST_ROW_Y] : [],
    ),
  );

/**
 * Where every step sits before the final lane clamp. With no stored position this is the default
 * layout. Otherwise a stored position wins and each step without one takes the first free row of
 * its lane (in rank order), so a step added later never lands on a stored one.
 */
const placedPositions = (loop: LoopDefinition): Map<string, Point> => {
  const defaults = defaultPositions(loop);
  if (!loop.steps.some((step) => step.position)) return defaults;
  const height = storedHeight(loop);
  const taken = new Map<Stage, Point[]>();
  const positions = new Map<string, Point>();
  const take = (stage: Stage, id: string, point: Point) => {
    positions.set(id, point);
    taken.set(stage, [...(taken.get(stage) ?? []), point]);
  };
  for (const step of loop.steps)
    if (step.position)
      take(stageOf(step), step.id, clampIntoLane(stageOf(step), step.position, height));
  for (const step of orderedSteps(loop)) {
    if (step.position) continue;
    const stage = stageOf(step);
    const x = defaults.get(step.id)?.x ?? toAbsoluteX(stage, DEFAULT_OFFSET_X);
    const others = taken.get(stage) ?? [];
    take(stage, step.id, { x, y: firstFreeRowY(x, others) });
  }
  return positions;
};

/** Lanes grow with the busiest lane and with stored positions, never below the minimum. */
export const laneHeight = (loop: LoopDefinition): number => {
  const placed = placedPositions(loop);
  const bottoms = loop.steps.map((step) => (placed.get(step.id)?.y ?? 0) + NODE_HEIGHT);
  return Math.max(MIN_LANE_HEIGHT, ...bottoms.map((bottom) => bottom + FIRST_ROW_Y));
};

/** Keeps a node wholly inside its lane, below the lane header. */
export const clampIntoLane = (stage: Stage, point: Point, height: number): Point => {
  const minX = toAbsoluteX(stage, LANE_PADDING);
  const maxX = toAbsoluteX(stage, LANE_DRAWN_WIDTH - NODE_WIDTH - LANE_PADDING);
  const minY = LANE_HEADER_HEIGHT;
  const maxY = height - NODE_HEIGHT - LANE_PADDING;
  return {
    x: Math.round(Math.min(maxX, Math.max(minX, point.x))),
    y: Math.round(Math.min(maxY, Math.max(minY, point.y))),
  };
};

/**
 * The position each step is drawn at: the stored position when present, else a free row of its
 * lane, always clamped into the step's own lane so a node never appears outside the lane that
 * names its stage.
 */
export const displayPositions = (loop: LoopDefinition): Map<string, Point> => {
  const placed = placedPositions(loop);
  const height = laneHeight(loop);
  return new Map(
    loop.steps.map((step) => [
      step.id,
      clampIntoLane(stageOf(step), placed.get(step.id) ?? { x: 0, y: 0 }, height),
    ]),
  );
};

/** Writes the drawn position of every step that has none yet. */
export const fillPositions = (loop: LoopDefinition): LoopDefinition => {
  if (loop.steps.every((step) => step.position)) return loop;
  const drawn = displayPositions(loop);
  return parseLoop({
    ...loop,
    steps: loop.steps.map((step) => ({ ...step, position: step.position ?? drawn.get(step.id) })),
  });
};

const NUDGE = 20;

/**
 * Moves a step a little to the right of where it is drawn, keeping its row (so it cannot start to
 * overlap a node it did not already overlap) and its lane, and writing every position so they stay
 * all-or-none. A step already at its lane's right edge is refused with a message instead of
 * storing a coordinate that is clamped away. It is synchronous and free of the drop planner, which
 * belongs to the lazily loaded Graph view.
 */
export const nudgeStepRight = (loop: LoopDefinition, id: string): LoopDefinition => {
  const step = loop.steps.find((item) => item.id === id);
  const drawn = displayPositions(loop).get(id);
  if (!step || !drawn) throw new Error("Select an existing step.");
  const moved = clampIntoLane(stageOf(step), { x: drawn.x + NUDGE, y: drawn.y }, laneHeight(loop));
  if (moved.x === drawn.x) throw new Error("This step is already at the right edge of its lane.");
  const filled = fillPositions(loop);
  return parseLoop({
    ...filled,
    steps: filled.steps.map((item) => (item.id === id ? { ...item, position: moved } : item)),
  });
};

/**
 * Keeps positions all-or-none: when some steps have a stored position and others do not, each
 * step without one is written at the position the Graph draws it at; a loop with no positions at
 * all (or every position) is returned unchanged. The Runs graph reads a stored position as
 * absolute and lays out the rest on its own grid, so a partly positioned loop would overlap there.
 */
export const completePositions = (loop: LoopDefinition): LoopDefinition =>
  loop.steps.some((step) => step.position) ? fillPositions(loop) : loop;
