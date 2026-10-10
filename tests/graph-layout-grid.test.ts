import { describe, expect, it } from "vitest";
import {
  completePositions,
  defaultPositions,
  displayPositions,
  FIRST_ROW_Y,
  laneHeight,
  laneOriginX,
  NODE_HEIGHT,
  nudgeToFreeRow,
  ROW_HEIGHT,
  RUN_NODE_WIDTH,
} from "../src/ui/features/loops/graph/graph-layout.js";
import { moveVisual } from "../src/ui/features/loops/loop-editor-model.js";
import { build, chain, edge } from "./support/loop-editor-builders.js";

const row = (index: number) => FIRST_ROW_Y + index * ROW_HEIGHT;

describe("free rows", () => {
  const lane = laneOriginX("implementation");

  it("leaves a free point unchanged and moves an overlapping one to the nearest free row", () => {
    const others = [{ x: lane + 16, y: row(0) }];
    const free = row(1) + 30;
    expect(nudgeToFreeRow({ x: lane + 16, y: free }, others, 520)).toEqual({
      x: lane + 16,
      y: free,
    });
    expect(nudgeToFreeRow({ x: lane + 20, y: row(0) + 12 }, others, 520)).toEqual({
      x: lane + 20,
      y: row(1),
    });
  });

  it("treats a node closer than the Runs graph's node height as overlapping", () => {
    const others = [{ x: lane + 16, y: row(0) }];
    // One pixel less than the node height apart: the Runs graph would draw the two overlapping.
    const close = row(0) + NODE_HEIGHT - 1;
    const apart = row(0) + NODE_HEIGHT;
    expect(nudgeToFreeRow({ x: lane + 16, y: close }, others, 520)).toEqual({
      x: lane + 16,
      y: row(1),
    });
    expect(nudgeToFreeRow({ x: lane + 16, y: apart }, others, 520)).toEqual({
      x: lane + 16,
      y: apart,
    });
  });

  it("keeps the point when no row is free", () => {
    const full = [0, 1, 2, 3].map((index) => ({ x: lane + 16, y: row(index) }));
    expect(nudgeToFreeRow({ x: lane + 16, y: row(0) + 12 }, full, 520)).toEqual({
      x: lane + 16,
      y: row(0) + 12,
    });
  });
});

describe("Runs graph compatibility", () => {
  it("fits the Runs graph's nodes without overlap on the default grid", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `s${index}`);
    const loop = build(ids, {
      dependencies: ids.slice(1).map((id, index) => edge(ids[index] ?? id, id)),
    });
    const boxes = [...defaultPositions(loop).values()].map((point) => ({
      ...point,
      width: RUN_NODE_WIDTH,
      height: NODE_HEIGHT,
    }));
    for (const [index, left] of boxes.entries())
      for (const right of boxes.slice(index + 1))
        expect(
          left.x < right.x + right.width &&
            right.x < left.x + left.width &&
            left.y < right.y + right.height &&
            right.y < left.y + left.height,
        ).toBe(false);
  });
});

const boxesOverlap = (left: { x: number; y: number }, right: { x: number; y: number }) =>
  Math.abs(left.x - right.x) < RUN_NODE_WIDTH && Math.abs(left.y - right.y) < NODE_HEIGHT;

describe("steps without a position next to stored ones", () => {
  const lane = laneOriginX("implementation");

  it("places an unpositioned step on a free row instead of on a stored step", () => {
    // b is stored on the row a would take by default; c would take b's default row.
    const loop = moveVisual(chain(), "b", lane + 16, FIRST_ROW_Y);
    const shown = displayPositions(loop);
    expect(shown.get("b")).toEqual({ x: lane + 16, y: FIRST_ROW_Y });
    const points = ["a", "b", "c"].map((id) => shown.get(id) ?? { x: 0, y: 0 });
    for (const [index, left] of points.entries())
      for (const right of points.slice(index + 1)) expect(boxesOverlap(left, right)).toBe(false);
    expect(laneHeight(loop)).toBeGreaterThanOrEqual(
      Math.max(...points.map((point) => point.y)) + NODE_HEIGHT,
    );
  });

  it("draws a loop with no stored position exactly as the default grid", () => {
    expect(displayPositions(chain())).toEqual(defaultPositions(chain()));
  });

  it("completes positions all-or-none and leaves complete or empty loops alone", () => {
    const partial = moveVisual(chain(), "b", lane + 16, FIRST_ROW_Y);
    const completed = completePositions(partial);
    const drawn = displayPositions(partial);
    for (const step of completed.steps) expect(step.position).toEqual(drawn.get(step.id));
    expect(completePositions(chain())).toEqual(chain());
    expect(completePositions(completed)).toBe(completed);
  });
});
