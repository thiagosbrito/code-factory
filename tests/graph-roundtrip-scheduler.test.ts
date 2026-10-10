// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseLoop, type LoopDefinition } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot, type RunRecord } from "../src/domain/run.js";
import { readySteps } from "../src/domain/scheduler.js";
import { buildGraph } from "../src/ui/features/loops/graph/graph-mapping.js";
import { laneOriginX } from "../src/ui/features/loops/graph/graph-layout.js";
import { structured } from "./support/loop-editor-builders.js";
import { harness } from "./support/graph-harness.js";
import { claim, pass } from "./support/scheduler.js";

const newRun = (loop: LoopDefinition): RunRecord =>
  createRunRecord(
    createRunSnapshot(
      parseLoop({ ...loop, status: "published" }),
      { description: "Task" },
      { provider: "mock", model: "default" },
    ),
  );

/** The ready set at every point of a run that always takes the first ready step and its first branch. */
const walk = (loop: LoopDefinition): string[][] => {
  let record = newRun(loop);
  const outcomes: Record<string, string> = { r2: "done", z: "pass" };
  const trace: string[][] = [];
  for (let guard = 0; guard < 30; guard += 1) {
    const ready = readySteps(record).map((item) => item.id);
    const first = ready[0];
    if (!first) break;
    trace.push(ready);
    record = pass(claim(record, first), first, outcomes[first]);
  }
  return trace;
};

const graphShape = (loop: LoopDefinition) => {
  const snapshot = newRun(loop).snapshot.loop;
  return {
    dependencies: snapshot.dependencies,
    groups: snapshot.groups,
    joins: snapshot.joins,
    decisions: snapshot.decisions,
    steps: snapshot.steps.map(({ id, groupId }) => ({ id, groupId })),
  };
};

const stages = (loop: LoopDefinition) => loop.steps.map(({ id, stage }) => [id, stage]);

describe("Board to Graph round trip keeps the run the scheduler sees", () => {
  it("walks the loop through readiness: s, both fan-out branches, the any-join, the repeat body and the decision", () => {
    expect(walk(structured())).toEqual([
      ["s"],
      ["b", "c"],
      ["c", "j"],
      ["j"],
      ["r1"],
      ["r2"],
      ["z"],
      ["y1"],
    ]);
  });

  it("opening the loop in the Graph leaves the very same loop and the same step graph and readiness", () => {
    const before = structured();
    const { hook, history } = harness(before);
    // Rendering the graph derives nodes and edges but never calls apply.
    expect(history().present).toBe(before);
    expect(history().past).toEqual([]);
    expect(buildGraph(history().present).edges).toHaveLength(before.dependencies.length);
    expect(graphShape(history().present)).toEqual(graphShape(before));
    expect(stages(history().present)).toEqual(stages(before));
    expect(walk(history().present)).toEqual(walk(before));
    hook.unmount();
    expect(history().present).toBe(before);
  });

  it("moving a step to the Validate lane in the Graph changes its place only, not the dependencies, structures or readiness", () => {
    const before = structured();
    const { hook, history, errors } = harness(before);
    const b = hook.result.current.nodes.find((item) => item.id === "s");
    if (!b || b.type !== "step") throw new Error("missing node s");
    const position = { x: laneOriginX("validation") + 16, y: 300 };
    act(() =>
      hook.result.current.onNodeDragStop(new MouseEvent("mouseup"), { ...b, position }, [
        { ...b, position },
      ]),
    );
    expect(errors).toEqual([]);
    expect(history().past).toHaveLength(1);
    const after = history().present;
    expect(after).not.toBe(before);
    expect(after.steps.find((item) => item.id === "s")?.position).toEqual(position);
    // Only the stage of the moved step differs; review semantics are untouched (no review step).
    expect(stages(after).filter(([id]) => id !== "s")).toEqual(
      stages(before).filter(([id]) => id !== "s"),
    );
    expect(graphShape(after)).toEqual(graphShape(before));
    expect(walk(after)).toEqual(walk(before));
  });
});
