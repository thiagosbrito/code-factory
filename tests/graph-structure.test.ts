import { describe, expect, it } from "vitest";
import { decisionSourceMessage } from "../src/ui/features/loops/loop-editor-dependencies.js";
import { displayPositions } from "../src/ui/features/loops/graph/graph-layout.js";
import {
  buildGraph,
  continuationEdges,
  regionNodes,
} from "../src/ui/features/loops/graph/graph-mapping.js";
import { groupRegions } from "../src/ui/features/loops/graph/graph-regions.js";
import {
  continuations,
  edgeStructure,
  joinLabel,
  stepBadges,
  stepNotes,
} from "../src/ui/features/loops/graph/graph-structure.js";
import { decided, joined, parallel, repeated, structured } from "./support/loop-editor-builders.js";

const step = (loop: ReturnType<typeof structured>, id: string) => {
  const found = loop.steps.find((item) => item.id === id);
  if (!found) throw new Error(`No step ${id}`);
  return found;
};

describe("group region geometry", () => {
  it("draws one padded region around all members of a parallel group", () => {
    const loop = parallel();
    const positions = displayPositions(loop);
    const [region, ...rest] = groupRegions(loop, positions);
    expect(rest).toEqual([]);
    const b = positions.get("b");
    const c = positions.get("c");
    if (!region || !b || !c) throw new Error("missing region or members");
    // Both members sit inside the one region, which also leaves room for its label below them.
    for (const member of [b, c]) {
      expect(region.x).toBeLessThan(member.x);
      expect(region.y).toBeLessThan(member.y);
      expect(region.x + region.width).toBeGreaterThan(member.x + 200);
      expect(region.y + region.height).toBeGreaterThan(member.y + 102);
    }
    expect(region).toMatchObject({ id: "g", kind: "parallel", label: "Parallel group: G" });
  });

  it("follows the members when they move and never reads or writes the loop", () => {
    const loop = parallel();
    const moved = new Map(displayPositions(loop));
    moved.set("c", { x: 500, y: 400 });
    const [before] = groupRegions(loop, displayPositions(loop));
    const [after] = groupRegions(loop, moved);
    expect(after?.width).toBeGreaterThan(before?.width ?? 0);
    expect(after?.height).toBeGreaterThan(before?.height ?? 0);
    expect(loop.steps.every((item) => item.position === undefined)).toBe(true);
  });

  it("labels a repeat group with its name and iteration limit and tells it from a parallel one", () => {
    const [region] = groupRegions(repeated(), displayPositions(repeated()));
    expect(region).toMatchObject({ kind: "repeat", label: "Repeat group: G (max 3 iterations)" });
  });

  it("skips a group whose members have no drawn position", () => {
    expect(groupRegions(parallel(), new Map())).toEqual([]);
  });

  it("builds non-interactive region nodes that take no pointer events", () => {
    const loop = structured();
    const nodes = regionNodes(loop, displayPositions(loop));
    expect(nodes.map((node) => node.id)).toEqual(["region:p", "region:g"]);
    for (const node of nodes) {
      expect(node).toMatchObject({
        draggable: false,
        selectable: false,
        focusable: false,
        connectable: false,
        deletable: false,
        style: { pointerEvents: "none" },
      });
    }
  });
});

describe("structure badges and notes", () => {
  it("words a join like the domain: waits for all or any", () => {
    expect(joinLabel("all")).toBe("waits for all");
    expect(joinLabel("any")).toBe("waits for any");
    const loop = structured();
    expect(stepBadges(loop, step(loop, "j"))).toEqual(["waits for any"]);
    expect(stepBadges(joined(), step(joined(), "d"))).toEqual(["waits for all"]);
  });

  it("badges group members and the source of a decision", () => {
    const loop = structured();
    expect(stepBadges(loop, step(loop, "b"))).toEqual(["parallel: Fan"]);
    expect(stepBadges(loop, step(loop, "r2"))).toEqual(["repeat: Again", "decision: done / again"]);
    expect(stepBadges(loop, step(loop, "s"))).toEqual([]);
  });

  it("blocks a connection from a decision with the model's own refusal and a Board pointer", () => {
    const loop = structured();
    const { startBlocked } = stepNotes(loop, step(loop, "z"));
    expect(startBlocked).toContain("Decision step: add a named branch in the Board view");
    expect(startBlocked).toContain(decisionSourceMessage("z"));
  });

  it("leaves a plain step and a join target free to connect", () => {
    const loop = structured();
    expect(stepNotes(loop, step(loop, "s")).startBlocked).toBeNull();
    expect(stepNotes(loop, step(loop, "j")).startBlocked).toBeNull();
  });

  it("explains group membership and joins in a note that points to the Board view", () => {
    const loop = structured();
    expect(stepNotes(loop, step(loop, "b")).note).toBe(
      "Member of parallel group Fan: its members cannot be ordered with each other. Edit it in the Board view.",
    );
    expect(stepNotes(loop, step(loop, "j")).note).toBe(
      "Join: waits for any of b, c. Edit it in the Board view.",
    );
    expect(stepNotes(loop, step(loop, "r1")).note).toContain("repeats up to 3 times");
    expect(stepNotes(loop, step(loop, "s")).note).toBe("");
  });
});

describe("edge structure", () => {
  it("labels each decision branch with its outcome and not the continuation", () => {
    const loop = structured();
    expect(edgeStructure(loop, "z", "y1")).toEqual({ outcomes: ["pass"], join: null });
    expect(edgeStructure(loop, "z", "y2")).toEqual({ outcomes: ["fail"], join: null });
    expect(edgeStructure(loop, "r2", "z")).toEqual({ outcomes: ["done"], join: null });
  });

  it("marks the edges that feed a join with its mode and no other edge", () => {
    const loop = structured();
    expect(edgeStructure(loop, "b", "j").join).toBe("any");
    expect(edgeStructure(loop, "c", "j").join).toBe("any");
    expect(edgeStructure(loop, "s", "b").join).toBeNull();
    expect(edgeStructure(decided(), "a", "b").join).toBeNull();
  });

  it("joins several outcomes that share a target into one label", () => {
    const loop = decided();
    expect(edgeStructure(loop, "a", "b").outcomes).toEqual(["yes"]);
  });

  it("carries the structure on the mapped dependency edges", () => {
    const edges = buildGraph(structured()).edges;
    const toJoin = edges.find((item) => item.id === "b->j");
    expect(toJoin?.className).toBe("graph-edge-join");
    expect(toJoin?.data?.join).toBe("any");
    expect(edges.find((item) => item.id === "s->b")?.className).toBeUndefined();
    expect(edges.find((item) => item.id === "z->y1")?.data?.outcomes).toEqual(["pass"]);
  });
});

describe("repeat continuation", () => {
  it("derives the back arrow from the exit decision to the start of the body", () => {
    const [item, ...rest] = continuations(structured());
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ groupId: "g", from: "r2", to: "r1", label: "again" });
    expect(item?.description).toContain("View only");
  });

  it("is a view-only edge outside the dependency list and out of reach of selection and deletion", () => {
    const loop = structured();
    const [arrow] = continuationEdges(loop);
    expect(arrow).toMatchObject({
      id: "continue:g",
      type: "continuation",
      source: "r2",
      target: "r1",
      selectable: false,
      focusable: false,
      deletable: false,
      reconnectable: false,
    });
    expect(loop.dependencies.some((edge) => edge.from === "r2" && edge.to === "r1")).toBe(false);
    expect(buildGraph(loop).edges.map((edge) => edge.id)).not.toContain("continue:g");
  });

  it("is absent from a loop without a repeat group", () => {
    expect(continuationEdges(parallel())).toEqual([]);
  });
});
