import { describe, expect, it } from "vitest";
import { parseLoop, type LoopDefinition } from "../src/domain/loop.js";
import { createStarterDraft } from "../src/domain/starter-templates.js";
import {
  addStep,
  moveVisual,
  semanticDrop,
  type Stage,
} from "../src/ui/features/loops/loop-editor-model.js";
import {
  completePositions,
  displayPositions,
  laneOriginX,
  overlaps,
} from "../src/ui/features/loops/loop-editor-placement.js";
import { build, edge } from "./support/loop-editor-builders.js";

const impl = laneOriginX("implementation");

const withStages = (loop: LoopDefinition, stages: Record<string, Stage>): LoopDefinition =>
  parseLoop({
    ...loop,
    steps: loop.steps.map((step) => ({ ...step, stage: stages[step.id] ?? step.stage })),
  });

/** What completePositions wrote must be exactly what the Graph draws, for every step. */
const expectWritesWhatTheGraphDraws = (loop: LoopDefinition) => {
  const drawn = displayPositions(loop);
  const completed = completePositions(loop);
  for (const step of loop.steps) {
    const written = completed.steps.find((item) => item.id === step.id)?.position;
    expect(written).toEqual(step.position ?? drawn.get(step.id));
  }
  const points = [...displayPositions(completed).values()];
  for (const [index, left] of points.entries())
    for (const right of points.slice(index + 1)) expect(overlaps(left, right)).toBe(false);
};

describe("completePositions matches the Graph's placement", () => {
  it("clamps a stored position into its own lane before looking for a free row", () => {
    // b was dropped into the Review lane but kept its old Implementation-lane coordinates.
    let loop = withStages(build(["a", "b", "c", "d"]), { b: "review", c: "review", d: "review" });
    loop = moveVisual(moveVisual(loop, "a", impl + 16, 48), "b", impl + 16, 48);
    expectWritesWhatTheGraphDraws(loop);
    expect(completePositions(loop).steps.every((step) => step.position)).toBe(true);
  });

  it("orders unpositioned steps by rank, as the Graph does, not by their place in the file", () => {
    // File order a, b, c; dependency order c, b, a.
    let loop = build(["a", "b", "c"], { dependencies: [edge("c", "b"), edge("b", "a")] });
    loop = moveVisual(loop, "a", impl + 16, 400);
    expectWritesWhatTheGraphDraws(loop);
    const written = completePositions(loop).steps;
    expect(written.find((step) => step.id === "c")?.position?.y).toBe(48);
    expect(written.find((step) => step.id === "b")?.position?.y).toBe(168);
  });

  it("leaves loops with no position or every position alone", () => {
    const none = build(["a", "b"]);
    expect(completePositions(none)).toBe(none);
    const all = moveVisual(moveVisual(none, "a", impl + 16, 48), "b", impl + 16, 168);
    expect(completePositions(all)).toBe(all);
  });

  it("gives a step added after a Board reorder a spot that does not overlap the moved step", () => {
    const base = createStarterDraft("compact", "starter");
    const positioned = base.steps.reduce(
      (loop, step) =>
        moveVisual(
          loop,
          step.id,
          laneOriginX(step.stage ?? "implementation") + 16,
          step.id === "review" ? 168 : 48,
        ),
      base,
    );
    // Implement moves into the Review lane (keeping its Implementation-lane position).
    const moved = semanticDrop(positioned, "implement", { stepId: "review", placement: "after" });
    expect(moved.steps.find((step) => step.id === "implement")?.stage).toBe("review");
    const added = completePositions(addStep(moved, "review", "agent"));
    const points = [...displayPositions(added).values()];
    for (const [index, left] of points.entries())
      for (const right of points.slice(index + 1)) expect(overlaps(left, right)).toBe(false);
    expect(added.steps.every((step) => step.position)).toBe(true);
  });
});
