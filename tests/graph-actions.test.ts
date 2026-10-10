import { describe, expect, it } from "vitest";
import {
  connectAction,
  connectionError,
  disconnectAction,
  dropAction,
  planDrops,
  refuse,
  connectEndRefusal,
  type ConnectEnd,
} from "../src/ui/features/loops/graph/graph-actions.js";
import {
  displayPositions,
  FIRST_ROW_Y,
  laneOriginX,
  NODE_WIDTH,
  ROW_HEIGHT,
} from "../src/ui/features/loops/graph/graph-layout.js";
import {
  cycleMessage,
  build,
  chain,
  decided,
  edge,
  parallel,
} from "./support/loop-editor-builders.js";
import { moveVisual, stageOf } from "../src/ui/features/loops/loop-editor-model.js";

const row = (index: number) => FIRST_ROW_Y + index * ROW_HEIGHT;

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

/** Steps a and b are drawn on the first two rows; c is stored far down so the lane has free rows. */
const withTallLane = (lane: number) => moveVisual(build(["a", "b", "c"]), "c", lane + 16, row(4));

describe("dropping a step", () => {
  const review = laneOriginX("review");

  it("stores an absolute position clamped into the lane it was dropped in", () => {
    const loop = chain();
    const drops = planDrops(loop, [{ id: "b", position: { x: review + 20, y: 9999 } }]);
    expect(drops[0]?.id).toBe("b");
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
    const next = dropAction(planDrops(loop, [{ id: "b", position: { x: lane + 24, y: row(1) } }]))(
      loop,
    );
    expect(next.steps.find((item) => item.id === "b")).toMatchObject({
      stage: "implementation",
      position: { x: lane + 24, y: row(1) },
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
    const moved = dropAction(planDrops(loop, [{ id: "b", position: { x: lane + 30, y: row(1) } }]))(
      loop,
    );
    expect(moved.steps.find((item) => item.id === "b")?.position).toEqual({
      x: lane + 30,
      y: row(1),
    });
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
      { id: "a", position: { x: lane + 30, y: row(1) } },
      { id: "b", position: { x: lane + 30, y: row(0) } },
    ]);
    const next = dropAction(drops)(loop);
    expect(next.steps.find((step) => step.id === "a")?.position?.y).toBe(row(1));
    expect(next.steps.find((step) => step.id === "b")?.position?.y).toBe(row(0));
  });

  it("treats the old spots of every dragged step as free when they move together", () => {
    const lane = laneOriginX("implementation");
    const loop = withTallLane(lane);
    // a is drawn at the first row and b at the second; both move down one row, so a lands on b's old spot.
    const drops = planDrops(loop, [
      { id: "a", position: { x: lane + 16, y: row(1) } },
      { id: "b", position: { x: lane + 16, y: row(2) } },
    ]);
    expect(drops.map((drop) => [drop.id, drop.position.y])).toEqual([
      ["a", row(1)],
      ["b", row(2)],
    ]);
  });

  it("does not drop one dragged step onto another that stays where it is drawn", () => {
    const lane = laneOriginX("implementation");
    const loop = withTallLane(lane);
    const drawn = displayPositions(loop);
    const drops = planDrops(loop, [
      { id: "a", position: { x: lane + 16, y: row(1) + 32 } },
      { id: "b", position: drawn.get("b") ?? { x: 0, y: 0 } },
    ]);
    const a = drops.find((drop) => drop.id === "a");
    expect(a?.position.y).toBe(row(2));
  });

  it("writes every step's drawn position on the first drop so positions are all-or-none", () => {
    const loop = chain();
    const drawn = displayPositions(loop);
    const lane = laneOriginX("implementation");
    const drops = planDrops(loop, [{ id: "b", position: { x: lane + 30, y: row(3) } }]);
    expect(drops.map((drop) => drop.id).sort()).toEqual(["a", "b", "c"]);
    const next = dropAction(drops)(loop);
    expect(next.steps.every((step) => step.position)).toBe(true);
    expect(next.steps.find((step) => step.id === "a")?.position).toEqual(drawn.get("a"));
    expect(next.steps.find((step) => step.id === "c")?.position).toEqual(drawn.get("c"));
  });

  it("leaves already positioned steps untouched on later drops", () => {
    const lane = laneOriginX("implementation");
    const first = dropAction(
      planDrops(chain(), [{ id: "b", position: { x: lane + 30, y: row(3) } }]),
    )(chain());
    const drops = planDrops(first, [{ id: "a", position: { x: lane + 30, y: row(1) } }]);
    expect(drops.map((drop) => drop.id)).toEqual(["a"]);
    const next = dropAction(drops)(first);
    expect(next.steps.find((step) => step.id === "c")?.position).toEqual(
      first.steps.find((step) => step.id === "c")?.position,
    );
  });

  it("keeps a fully positioned loop's untouched steps unchanged", () => {
    const placed = ["a", "b", "c"].reduce(
      (loop, id, index) => moveVisual(loop, id, laneOriginX("implementation") + 16, row(index)),
      chain(),
    );
    const drops = planDrops(placed, [
      { id: "a", position: { x: laneOriginX("implementation") + 30, y: row(3) } },
    ]);
    expect(drops.map((drop) => drop.id)).toEqual(["a"]);
  });

  it("nudges a drop that lands on another step to the nearest free row", () => {
    const lane = laneOriginX("implementation");
    // d is stored far down, so the lane has a free fourth row. b dropped on c (third row): a holds
    // the first row, and b's own second row is free but farther than the fourth.
    const loop = moveVisual(
      build(["a", "b", "c", "d"], {
        dependencies: [edge("a", "b"), edge("b", "c"), edge("c", "d")],
      }),
      "d",
      lane + 16,
      row(4),
    );
    const drops = planDrops(loop, [{ id: "b", position: { x: lane + 16, y: row(2) + 12 } }]);
    expect(drops.find((drop) => drop.id === "b")?.position.y).toBe(row(3));
  });
});

describe("refusals reported without changing anything", () => {
  const end = (over: Partial<ConnectEnd>): ConnectEnd => ({
    isValid: false,
    fromNode: { id: "a" },
    toNode: { id: "c" },
    fromHandle: { type: "source" },
    toHandle: { type: "target" },
    ...over,
  });

  it("explains a cycle and a duplicate", () => {
    expect(connectEndRefusal(chain(), end({ fromNode: { id: "c" }, toNode: { id: "a" } }))).toBe(
      cycleMessage,
    );
    expect(connectEndRefusal(chain(), end({ toNode: { id: "b" } }))).toBe(
      "Step a already leads to step b.",
    );
  });

  it("explains nothing for same-kind handles, the same node, no target or a valid release", () => {
    expect(connectEndRefusal(chain(), end({ toHandle: { type: "source" } }))).toBeNull();
    const inputs = end({ fromHandle: { type: "target" }, toHandle: { type: "target" } });
    expect(connectEndRefusal(chain(), inputs)).toBeNull();
    expect(connectEndRefusal(chain(), end({ toNode: { id: "a" } }))).toBeNull();
    expect(connectEndRefusal(chain(), end({ toNode: null, toHandle: null }))).toBeNull();
    expect(connectEndRefusal(chain(), end({ isValid: true }))).toBeNull();
    expect(connectEndRefusal(chain(), end({ isValid: null }))).toBeNull();
  });

  it("reads a drag that started on an input handle in dependency direction", () => {
    const reverse = end({ fromHandle: { type: "target" }, toHandle: { type: "source" } });
    // Dragging from a's input to c's output means c leads to a, which closes a cycle.
    expect(connectEndRefusal(chain(), reverse)).toBe(cycleMessage);
  });

  it("refuse throws its message so apply shows it and records no history", () => {
    expect(() => refuse("nope")(chain())).toThrow("nope");
  });
});
