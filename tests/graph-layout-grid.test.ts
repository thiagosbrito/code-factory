import { describe, expect, it } from "vitest";
import {
  defaultPositions,
  laneOriginX,
  nudgeToFreeRow,
} from "../src/ui/features/loops/graph/graph-layout.js";
import { build, edge } from "./support/loop-editor-builders.js";

describe("free rows", () => {
  const lane = laneOriginX("implementation");

  it("leaves a free point unchanged and moves an overlapping one to the nearest free row", () => {
    const others = [{ x: lane + 16, y: 48 }];
    expect(nudgeToFreeRow({ x: lane + 16, y: 300 }, others, 520)).toEqual({ x: lane + 16, y: 300 });
    expect(nudgeToFreeRow({ x: lane + 20, y: 60 }, others, 520)).toEqual({ x: lane + 20, y: 168 });
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
