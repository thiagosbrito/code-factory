// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { buildGraph } from "../src/ui/features/loops/graph/graph-mapping.js";
import { build, chain, cycleMessage } from "./support/loop-editor-builders.js";
import { harness } from "./support/graph-harness.js";
import { stubReactFlowGlobals } from "./support/react-flow.js";

beforeEach(stubReactFlowGlobals);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const released = (
  from: string,
  to: string,
  kinds: { from: "source" | "target"; to: "source" | "target" },
) => ({
  isValid: false,
  fromNode: { id: from },
  toNode: { id: to },
  fromHandle: { type: kinds.from },
  toHandle: { type: kinds.to },
});

describe("Graph editor connection reports", () => {
  it("never adds a dependency for output-to-output or input-to-input releases", () => {
    const { hook, history, errors } = harness(chain());
    const outputs = released("a", "c", { from: "source", to: "source" });
    const inputs = released("a", "c", { from: "target", to: "target" });
    act(() => hook.result.current.reportConnectEnd(outputs));
    act(() => hook.result.current.reportConnectEnd(inputs));
    expect(history().past).toEqual([]);
    expect(history().present.dependencies).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it("explains a cycle without changing the loop or history", () => {
    const { hook, history, errors } = harness(chain());
    const back = released("c", "a", { from: "source", to: "target" });
    act(() => hook.result.current.reportConnectEnd(back));
    expect(errors).toEqual([cycleMessage]);
    expect(history().past).toEqual([]);
    expect(history().present.dependencies).toHaveLength(2);
  });

  it("explains a duplicate drop instead of staying silent", () => {
    const { hook, history, errors } = harness(chain());
    const again = released("a", "b", { from: "source", to: "target" });
    act(() => hook.result.current.reportConnectEnd(again));
    expect(errors).toEqual(["Step a already leads to step b."]);
    expect(history().past).toEqual([]);
  });

  it("makes exactly one history entry for a successful connect", () => {
    const { hook, history } = harness(chain());
    const connection = { source: "a", target: "c", sourceHandle: null, targetHandle: null };
    act(() => hook.result.current.onConnect(connection));
    expect(history().past).toHaveLength(1);
  });
});

describe("Graph editor on a large loop", () => {
  const ids = Array.from({ length: 30 }, (_, index) => `s${String(index).padStart(2, "0")}`);

  it("keeps its flow state when rendered again with the same loop", () => {
    const { hook } = harness(build(ids));
    const before = hook.result.current.nodes;
    for (let frame = 0; frame < 20; frame += 1) hook.rerender();
    expect(hook.result.current.nodes).toBe(before);
    expect(before.filter((node) => node.type === "step")).toHaveLength(30);
  });

  it("derives the graph for 30 steps well inside a frame budget", () => {
    const loop = build(ids);
    const started = performance.now();
    for (let run = 0; run < 20; run += 1) buildGraph(loop);
    expect((performance.now() - started) / 20).toBeLessThan(50);
  });
});
