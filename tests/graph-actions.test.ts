import { describe, expect, it } from "vitest";
import {
  connectAction,
  connectionError,
  disconnectAction,
  dropAction,
  planDrops,
} from "../src/ui/features/loops/graph/graph-actions.js";
import {
  displayPositions,
  laneOriginX,
  NODE_WIDTH,
} from "../src/ui/features/loops/graph/graph-layout.js";
import {
  cycleMessage,
  build,
  chain,
  decided,
  edge,
  parallel,
} from "./support/loop-editor-builders.js";
import { stageOf } from "../src/ui/features/loops/loop-editor-model.js";

const stageOfId = (loop: ReturnType<typeof chain>, id: string) => {
  const step = loop.steps.find((item) => item.id === id);
  return step ? stageOf(step) : undefined;
};

describe("connecting", () => {
  it("allows a valid connection and does not touch the loop while checking", () => {
    const loop = chain();
    const before = JSON.stringify(loop);
    expect(connectionError(loop, "a", "c")).toBeNull();
    expect(JSON.stringify(loop)).toBe(before);
  });

  it("refuses a cycle with the domain message and a duplicate with a readable one", () => {
    expect(connectionError(chain(), "c", "a")).toBe(cycleMessage);
    expect(connectionError(chain(), "a", "b")).toBe("Step a already leads to step b.");
    expect(connectionError(chain(), "a", "a")).toBe(cycleMessage);
  });

  it("refuses a plain connection out of a decision", () => {
    expect(connectionError(decided(), "a", "d")).toContain("is a decision");
  });

  it("adds the dependency through the model, and a repeated connect is a no-op", () => {
    const loop = chain();
    const added = connectAction("a", "c")(loop);
    expect(added.dependencies).toContainEqual(edge("a", "c"));
    expect(connectAction("a", "b")(loop)).toBe(loop);
  });

  it("throws on a refused connect so the editor reports it and keeps the loop", () => {
    expect(() => connectAction("c", "a")(chain())).toThrow(cycleMessage);
  });
});

describe("disconnecting", () => {
  it("removes the dependencies together or not at all", () => {
    const loop = chain();
    const removed = disconnectAction([{ source: "a", target: "b" }])(loop);
    expect(removed.dependencies).toEqual([edge("b", "c")]);
    expect(() =>
      disconnectAction([
        { source: "a", target: "b" },
        { source: "a", target: "c" },
      ])(loop),
    ).toThrow("does not lead to");
    expect(loop.dependencies).toHaveLength(2);
  });

  it("refuses to drop a decision below two branches", () => {
    expect(() => disconnectAction([{ source: "a", target: "b" }])(decided())).toThrow(
      "fewer than two branches",
    );
  });
});

describe("dropping a step", () => {
  const review = laneOriginX("review");

  it("stores an absolute position clamped into the lane it was dropped in", () => {
    const loop = chain();
    const drops = planDrops(loop, [{ id: "b", position: { x: review + 20, y: 9999 } }]);
    expect(drops).toHaveLength(1);
    expect(drops[0]?.stage).toBe("review");
    const next = dropAction(drops)(loop);
    const step = next.steps.find((item) => item.id === "b");
    expect(stageOfId(next, "b")).toBe("review");
    expect(step?.position?.x).toBe(review + 20);
    expect(step?.position?.y).toBeLessThan(520);
    expect(next.dependencies).toEqual(loop.dependencies);
  });

  it("changes only the position when the step stays in its lane", () => {
    const loop = chain();
    const lane = laneOriginX("implementation");
    const next = dropAction(planDrops(loop, [{ id: "b", position: { x: lane + 24, y: 300 } }]))(
      loop,
    );
    expect(next.steps.find((item) => item.id === "b")).toMatchObject({
      stage: "implementation",
      position: { x: lane + 24, y: 300 },
    });
  });

  it("leaves a step that ends up where it is drawn alone, so a click writes nothing", () => {
    const loop = chain();
    const shown = displayPositions(loop).get("a");
    expect(shown).toBeDefined();
    expect(planDrops(loop, [{ id: "a", position: shown ?? { x: 0, y: 0 } }])).toEqual([]);
  });

  it("lets a member of a parallel group move within its lane but refuses a lane change", () => {
    const loop = parallel();
    const lane = laneOriginX("implementation");
    const moved = dropAction(planDrops(loop, [{ id: "b", position: { x: lane + 30, y: 400 } }]))(
      loop,
    );
    expect(moved.steps.find((item) => item.id === "b")?.position).toEqual({ x: lane + 30, y: 400 });
    expect(() =>
      dropAction(planDrops(loop, [{ id: "b", position: { x: laneOriginX("review"), y: 100 } }]))(
        loop,
      ),
    ).toThrow("belongs to a group, join, or decision");
  });

  it("lets a check step enter Validate only", () => {
    const loop = build(["a", "k"], { checks: ["k"] });
    const drops = planDrops(loop, [
      { id: "k", position: { x: laneOriginX("review") + 10, y: 100 } },
    ]);
    expect(() => dropAction(drops)(loop)).toThrow("Check steps belong in Validate.");
    const ok = planDrops(loop, [
      { id: "k", position: { x: laneOriginX("validation") + 10, y: 100 } },
    ]);
    expect(stageOfId(dropAction(ok)(loop), "k")).toBe("validation");
  });

  it("decides the lane by the node centre", () => {
    const loop = chain();
    const edgeOfReview = laneOriginX("review") - NODE_WIDTH / 2;
    expect(
      planDrops(loop, [{ id: "a", position: { x: edgeOfReview + 1, y: 100 } }])[0]?.stage,
    ).toBe("review");
    expect(
      planDrops(loop, [{ id: "a", position: { x: edgeOfReview - 1, y: 100 } }])[0]?.stage,
    ).toBe("implementation");
  });

  it("applies several dragged steps as a single transformation", () => {
    const loop = chain();
    const lane = laneOriginX("implementation");
    const drops = planDrops(loop, [
      { id: "a", position: { x: lane + 30, y: 300 } },
      { id: "b", position: { x: lane + 30, y: 420 } },
    ]);
    const next = dropAction(drops)(loop);
    expect(next.steps.filter((step) => step.position)).toHaveLength(2);
  });
});
