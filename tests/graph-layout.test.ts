import { describe, expect, it } from "vitest";
import {
  clampIntoLane,
  defaultPositions,
  displayPositions,
  FIRST_ROW_Y,
  laneAtX,
  laneHeight,
  LANE_DRAWN_WIDTH,
  laneOriginX,
  MIN_LANE_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
  ranksOf,
  ROW_HEIGHT,
  toAbsoluteX,
  toLaneOffsetX,
} from "../src/ui/features/loops/graph/graph-layout.js";
import { stages } from "../src/ui/features/loops/loop-editor-model.js";
import { moveVisual } from "../src/ui/features/loops/loop-editor-model.js";
import { build, chain, edge, joined, parallel } from "./support/loop-editor-builders.js";

const row = (index: number) => FIRST_ROW_Y + index * ROW_HEIGHT;

describe("graph layout", () => {
  it("places the three-step starter shape at the first row of each lane", () => {
    const loop = build(["implement", "review", "validate"], {
      dependencies: [edge("implement", "review"), edge("review", "validate")],
    });
    const positions = defaultPositions(loop);
    // All three are in the implementation lane in this builder, so they stack by rank.
    expect([...positions.values()].map((point) => point.y)).toEqual([row(0), row(1), row(2)]);
    expect(new Set([...positions.values()].map((point) => point.x))).toEqual(
      new Set([laneOriginX("implementation") + 16]),
    );
  });

  it("is deterministic and independent of step order in the file", () => {
    const loop = joined();
    const shuffled = { ...loop, steps: [...loop.steps].reverse() };
    expect([...defaultPositions(loop)].sort()).toEqual([...defaultPositions(shuffled)].sort());
    expect(defaultPositions(loop)).toEqual(defaultPositions(loop));
  });

  it("orders rows by rank then id so fan-out siblings are adjacent", () => {
    const rank = ranksOf(parallel());
    expect(Object.fromEntries(rank)).toEqual({ a: 0, b: 1, c: 1, d: 2 });
    const positions = defaultPositions(parallel());
    expect(positions.get("b")?.y).toBe(row(1));
    expect(positions.get("c")?.y).toBe(row(2));
  });

  it("lets a stored position win and never invents one", () => {
    const loop = moveVisual(chain(), "b", laneOriginX("implementation") + 30, 400);
    const shown = displayPositions(loop);
    expect(shown.get("b")).toEqual({ x: laneOriginX("implementation") + 30, y: 400 });
    expect(loop.steps.find((step) => step.id === "a")?.position).toBeUndefined();
    expect(chain().steps.every((step) => step.position === undefined)).toBe(true);
  });

  it("clamps a stored position that lies outside its lane for display only", () => {
    const loop = moveVisual(chain(), "a", 5000, -300);
    const shown = displayPositions(loop).get("a");
    expect(shown?.x).toBeLessThanOrEqual(laneOriginX("implementation") + LANE_DRAWN_WIDTH);
    expect(shown?.x).toBeGreaterThanOrEqual(laneOriginX("implementation"));
    expect(shown?.y).toBe(40);
    expect(loop.steps.find((step) => step.id === "a")?.position).toEqual({ x: 5000, y: -300 });
  });

  it("grows the lanes with the busiest lane", () => {
    const pair = build(["a", "b"], { dependencies: [edge("a", "b")] });
    expect(laneHeight(pair)).toBe(MIN_LANE_HEIGHT);
    expect(laneHeight(chain())).toBe(row(2) + NODE_HEIGHT + FIRST_ROW_Y);
    const ids = Array.from({ length: 8 }, (_, index) => `s${index}`);
    expect(laneHeight(build(ids))).toBeGreaterThan(MIN_LANE_HEIGHT);
  });
});

describe("lane geometry", () => {
  it("converts between absolute x and the offset inside a lane", () => {
    for (const stage of stages) {
      expect(toLaneOffsetX(stage.id, toAbsoluteX(stage.id, 17))).toBe(17);
    }
    expect(laneOriginX("evidence")).toBe(0);
  });

  it("finds the lane under a node by its centre and extends the outer lanes", () => {
    expect(laneAtX(laneOriginX("planning") + 16)).toBe("planning");
    expect(laneAtX(laneOriginX("review") - NODE_WIDTH / 2 - 1)).toBe("implementation");
    expect(laneAtX(laneOriginX("review") - NODE_WIDTH / 2)).toBe("review");
    expect(laneAtX(-5000)).toBe("evidence");
    expect(laneAtX(99999)).toBe("validation");
  });

  it("clamps a point into the lane, below its header, with whole numbers", () => {
    const height = 520;
    const high = clampIntoLane("review", { x: 99999, y: 99999 }, height);
    expect(high.y).toBe(height - NODE_HEIGHT - 8);
    expect(high.x + NODE_WIDTH).toBeLessThanOrEqual(laneOriginX("review") + LANE_DRAWN_WIDTH);
    const low = clampIntoLane("review", { x: -99, y: -99 }, height);
    expect(low).toEqual({ x: laneOriginX("review") + 8, y: 40 });
    expect(clampIntoLane("review", { x: laneOriginX("review") + 20.4, y: 100.6 }, height)).toEqual({
      x: laneOriginX("review") + 20,
      y: 101,
    });
  });
});
