import { describe, expect, it } from "vitest";
import {
  displayPositions,
  laneOriginX,
  nudgeStepRight,
} from "../src/ui/features/loops/graph/graph-layout.js";
import { chain } from "./support/loop-editor-builders.js";

describe("nudging a step right", () => {
  const lane = laneOriginX("implementation");

  it("writes every position, not a lone coordinate, for a loop with none", () => {
    const loop = chain();
    const next = nudgeStepRight(loop, "b");
    expect(next.steps.every((step) => step.position)).toBe(true);
    expect(next.steps.find((step) => step.id === "b")?.position).toEqual({
      x: lane + 36,
      y: displayPositions(loop).get("b")?.y,
    });
    expect(next.steps.find((step) => step.id === "a")?.position).toEqual(
      displayPositions(loop).get("a"),
    );
  });

  it("refuses with a message when the step is already at its lane's right edge", () => {
    const once = nudgeStepRight(chain(), "b");
    expect(() => nudgeStepRight(once, "b")).toThrow(
      new Error("This step is already at the right edge of its lane."),
    );
  });

  it("refuses a step that does not exist", () => {
    expect(() => nudgeStepRight(chain(), "nope")).toThrow(new Error("Select an existing step."));
  });
});
