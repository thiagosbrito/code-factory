import { describe, expect, it } from "vitest";
import {
  completePositions,
  defaultPositions,
  displayPositions,
  laneHeight,
  laneOriginX,
  nudgeToFreeRow,
} from "../src/ui/features/loops/graph/graph-layout.js";
import { moveVisual } from "../src/ui/features/loops/loop-editor-model.js";
import { build, chain, edge } from "./support/loop-editor-builders.js";

describe("free rows", () => {
  const lane = laneOriginX("implementation");

  it("leaves a free point unchanged and moves an overlapping one to the nearest free row", () => {
    const others = [{ x: lane + 16, y: 48 }];
    expect(nudgeToFreeRow({ x: lane + 16, y: 300 }, others, 520)).toEqual({ x: lane + 16, y: 300 });
    expect(nudgeToFreeRow({ x: lane + 20, y: 60 }, others, 520)).toEqual({ x: lane + 20, y: 168 });
  });

  it("treats a node closer than the Runs graph's 102 px height as overlapping", () => {
    const others = [{ x: lane + 16, y: 48 }];
    // 95 px apart: free at the old 88 px height, but the Runs graph would draw the two overlapping.
    expect(nudgeToFreeRow({ x: lane + 16, y: 143 }, others, 520)).toEqual({ x: lane + 16, y: 168 });
    expect(nudgeToFreeRow({ x: lane + 16, y: 150 }, others, 520)).toEqual({ x: lane + 16, y: 150 });
  });

  it("keeps the point when no row is free", () => {
    const full = [48, 168, 288, 408].map((y) => ({ x: lane + 16, y }));
    expect(nudgeToFreeRow({ x: lane + 16, y: 60 }, full, 520)).toEqual({ x: lane + 16, y: 60 });
  });
});

describe("Runs graph compatibility", () => {
  it("fits the Runs graph's 210 by 102 nodes without overlap on the default grid", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `s${index}`);
    const loop = build(ids, {
      dependencies: ids.slice(1).map((id, index) => edge(ids[index] ?? id, id)),
    });
    const boxes = [...defaultPositions(loop).values()].map((point) => ({
      ...point,
      width: 210,
      height: 102,
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
  Math.abs(left.x - right.x) < 210 && Math.abs(left.y - right.y) < 102;

describe("steps without a position next to stored ones", () => {
  const lane = laneOriginX("implementation");

  it("places an unpositioned step on a free row instead of on a stored step", () => {
    // b is stored on the row a would take by default; c would take b's default row.
    const loop = moveVisual(chain(), "b", lane + 16, 48);
    const shown = displayPositions(loop);
    expect(shown.get("b")).toEqual({ x: lane + 16, y: 48 });
    const points = ["a", "b", "c"].map((id) => shown.get(id) ?? { x: 0, y: 0 });
    for (const [index, left] of points.entries())
      for (const right of points.slice(index + 1)) expect(boxesOverlap(left, right)).toBe(false);
    expect(laneHeight(loop)).toBeGreaterThanOrEqual(
      Math.max(...points.map((point) => point.y)) + 102,
    );
  });

  it("draws a loop with no stored position exactly as the default grid", () => {
    expect(displayPositions(chain())).toEqual(defaultPositions(chain()));
  });

  it("completes positions all-or-none and leaves complete or empty loops alone", () => {
    const partial = moveVisual(chain(), "b", lane + 16, 48);
    const completed = completePositions(partial);
    const drawn = displayPositions(partial);
    for (const step of completed.steps) expect(step.position).toEqual(drawn.get(step.id));
    expect(completePositions(chain())).toEqual(chain());
    expect(completePositions(completed)).toBe(completed);
  });
});
