import { stages, type Stage } from "../loop-editor-model";
import {
  FIRST_ROW_Y,
  LANE_PADDING,
  laneOriginX,
  LANE_WIDTH,
  NODE_HEIGHT,
  NODE_WIDTH,
  overlaps,
  ROW_HEIGHT,
  type Point,
} from "../loop-editor-placement";

/**
 * Geometry used only by the Graph view's drop planner. The placement rules the Board shares with
 * it live in `loop-editor-placement.ts` and are re-exported here.
 */
export * from "../loop-editor-placement";

export const toLaneOffsetX = (stage: Stage, absoluteX: number): number =>
  absoluteX - laneOriginX(stage);

/** The lane under a node, decided by the node's horizontal centre; the ends extend outwards. */
export const laneAtX = (absoluteX: number): Stage => {
  const index = Math.floor((absoluteX + NODE_WIDTH / 2) / LANE_WIDTH);
  const lane = stages[Math.min(stages.length - 1, Math.max(0, index))];
  return lane ? lane.id : "implementation";
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
