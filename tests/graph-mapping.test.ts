import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/ui/features/loops/graph/graph-mapping.js";
import { laneOriginX, ROW_HEIGHT } from "../src/ui/features/loops/graph/graph-layout.js";
import { stages } from "../src/ui/features/loops/loop-editor-model.js";
import { build, chain, decided, edge, joined, parallel } from "./support/loop-editor-builders.js";

describe("loop to graph mapping", () => {
  it("draws five non-interactive lanes in stage order, then one node per step", () => {
    const { nodes } = buildGraph(chain());
    const lanes = nodes.filter((node) => node.type === "lane");
    expect(lanes.map((lane) => lane.data.title)).toEqual(stages.map((stage) => stage.name));
    expect(lanes.map((lane) => lane.position.x)).toEqual(
      stages.map((stage) => laneOriginX(stage.id)),
    );
    for (const lane of lanes) {
      expect(lane).toMatchObject({ draggable: false, selectable: false, deletable: false });
    }
    expect(nodes.filter((node) => node.type === "step").map((node) => node.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    // Lanes come first so they are drawn beneath.
    expect(nodes.slice(0, 5).every((node) => node.type === "lane")).toBe(true);
  });

  it("makes one edge per dependency between the same steps and never animates it", () => {
    const loop = joined();
    const { edges } = buildGraph(loop);
    expect(edges.map((item) => [item.source, item.target])).toEqual(
      loop.dependencies.map((item) => [item.from, item.to]),
    );
    expect(edges.every((item) => item.animated === false)).toBe(true);
    expect(edges.map((item) => item.ariaLabel)).toContain("Dependency from a to b");
  });

  it("gives steps accessible names, structure badges and refuses node deletion", () => {
    const decision = buildGraph(decided()).nodes.find((node) => node.id === "a");
    expect(decision?.type === "step" && decision.data.badges).toEqual(["decision: yes / no"]);
    const grouped = buildGraph(parallel()).nodes.find((node) => node.id === "b");
    expect(grouped?.type === "step" && grouped.data.badges).toEqual(["parallel: G"]);
    expect(grouped).toMatchObject({ deletable: false, draggable: true });
    expect(grouped?.ariaLabel).toBe("b, Role, agent step in 3. Implementation");
  });

  it("places a check step in the Validate lane and an unstaged agent step in Implementation", () => {
    const loop = build(["a", "k"], { checks: ["k"], unstaged: ["a"] });
    const nodes = buildGraph(loop).nodes;
    const x = (id: string) => nodes.find((node) => node.id === id)?.position.x;
    expect(x("a")).toBe(laneOriginX("implementation") + 16);
    expect(x("k")).toBe(laneOriginX("validation") + 16);
  });

  it("puts parallel members in the same lane on adjacent rows", () => {
    const nodes = buildGraph(parallel()).nodes;
    const y = (id: string) => nodes.find((node) => node.id === id)?.position.y ?? 0;
    expect(Math.abs(y("b") - y("c"))).toBe(ROW_HEIGHT);
    expect(nodes.find((node) => node.id === "b")?.position.x).toBe(
      nodes.find((node) => node.id === "c")?.position.x,
    );
  });

  it("declares size and handles so edges can render before the browser measures", () => {
    const step = buildGraph(chain()).nodes.find((node) => node.id === "a");
    expect(step?.width).toBeGreaterThan(0);
    expect(step?.handles?.map((handle) => handle.type)).toEqual(["target", "source"]);
  });

  it("is a pure function of the loop", () => {
    const loop = build(["a", "b"], { dependencies: [edge("a", "b")] });
    expect(JSON.stringify(buildGraph(loop))).toBe(JSON.stringify(buildGraph(loop)));
  });
});
