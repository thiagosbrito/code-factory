import { parseLoop, type LoopDefinition } from "../../../../domain/loop.js";
import { stageOf, stages, type Stage } from "../loop-editor-model";

/**
 * Pure geometry for the Graph view. Every coordinate is an ABSOLUTE canvas coordinate, the same
 * space the Runs graph reads from `step.position`. A "lane offset" is the distance from a lane's
 * left edge; it exists only inside these helpers and is never stored.
 */

export type Point = { x: number; y: number };

export const LANE_WIDTH = 260;
/** The visible lane is a little narrower than its slot so neighbouring lanes show a gutter. */
export const LANE_DRAWN_WIDTH = LANE_WIDTH - 16;
export const NODE_WIDTH = 200;
/** The Runs graph draws every node at least 210 x 102; overlap and row spacing use that size. */
export const RUN_NODE_WIDTH = 210;
export const NODE_HEIGHT = 102;
export const ROW_HEIGHT = 120;
export const FIRST_ROW_Y = 48;
export const DEFAULT_OFFSET_X = 16;
export const MIN_LANE_HEIGHT = 520;
const LANE_PADDING = 8;
const LANE_HEADER_HEIGHT = 40;

export const stageIndex = (stage: Stage): number => stages.findIndex((item) => item.id === stage);

/** The x of a lane's left edge. */
export const laneOriginX = (stage: Stage): number => stageIndex(stage) * LANE_WIDTH;

export const toAbsoluteX = (stage: Stage, offsetX: number): number => laneOriginX(stage) + offsetX;

export const toLaneOffsetX = (stage: Stage, absoluteX: number): number =>
  absoluteX - laneOriginX(stage);

/** The lane under a node, decided by the node's horizontal centre; the ends extend outwards. */
export const laneAtX = (absoluteX: number): Stage => {
  const index = Math.floor((absoluteX + NODE_WIDTH / 2) / LANE_WIDTH);
  const lane = stages[Math.min(stages.length - 1, Math.max(0, index))];
  return lane ? lane.id : "implementation";
};

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

const overlaps = (left: Point, right: Point): boolean =>
  Math.abs(left.x - right.x) < RUN_NODE_WIDTH && Math.abs(left.y - right.y) < NODE_HEIGHT;

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
    let y = FIRST_ROW_Y;
    while (others.some((other) => overlaps({ x, y }, other))) y += ROW_HEIGHT;
    take(stage, step.id, { x, y });
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

/**
 * Keeps positions all-or-none: when any step has a stored position, every step without one is
 * written at the position it is drawn at; a loop with no positions at all is returned unchanged.
 * The Runs graph reads a stored position as absolute and lays out the rest on its own grid, so a
 * partly positioned loop would overlap there.
 */
export const completePositions = (loop: LoopDefinition): LoopDefinition => {
  if (!loop.steps.some((step) => step.position) || loop.steps.every((step) => step.position))
    return loop;
  const drawn = displayPositions(loop);
  return parseLoop({
    ...loop,
    steps: loop.steps.map((step) => ({ ...step, position: step.position ?? drawn.get(step.id) })),
  });
};

/**
 * Moves a point to the nearest free row of its lane when it would sit on another node; a free
 * point is returned unchanged. `neighbours` are the other nodes of the same lane. With no free
 * row left the point is kept (overlap is accepted rather than refusing the drop).
 */
export const nudgeToFreeRow = (point: Point, neighbours: Point[], height: number): Point => {
  if (!neighbours.some((other) => overlaps(point, other))) return point;
  const rows: Point[] = [];
  for (let y = FIRST_ROW_Y; y + NODE_HEIGHT + LANE_PADDING <= height; y += ROW_HEIGHT)
    rows.push({ x: point.x, y });
  const free = rows.filter((row) => !neighbours.some((other) => overlaps(row, other)));
  const nearest = free.reduce<Point | undefined>(
    (best, row) => (!best || Math.abs(row.y - point.y) < Math.abs(best.y - point.y) ? row : best),
    undefined,
  );
  return nearest ?? point;
};
