import { describe, expect, it } from "vitest";
import { createLoopDraft, parseLoop } from "../src/domain/loop.js";
import {
  assignStepToGroup,
  commit,
  moveVisual,
  redo,
  removeGroup,
  semanticDrop,
  setDecision,
  setJoin,
  setParallelGroup,
  setRepeatGroup,
  undo,
} from "../src/ui/loop-editor-model.js";

function chain() {
  return parseLoop({
    ...createLoopDraft("example", "Example"),
    steps: [
      {
        id: "a",
        name: "A",
        kind: "agent",
        stage: "implementation",
        role: "Builder",
        instruction: "Build",
        expectedOutputs: ["A result"],
      },
      {
        id: "b",
        name: "B",
        kind: "agent",
        stage: "implementation",
        role: "Reviewer",
        instruction: "Review",
        expectedOutputs: ["B result"],
      },
      {
        id: "c",
        name: "C",
        kind: "check",
        stage: "validation",
        role: "Checker",
        instruction: "Check",
        expectedOutputs: ["C result"],
      },
    ],
    dependencies: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ],
  });
}

describe("semantic loop editor", () => {
  it("keeps coordinates separate from execution order and rewires only an explicit drop target", () => {
    const initial = chain();
    const visual = moveVisual(initial, "a", 400, 200);
    expect(visual.dependencies).toEqual(initial.dependencies);
    const moved = semanticDrop(initial, "b", { stepId: "a", placement: "before" });
    expect(moved.dependencies).toEqual([
      { from: "a", to: "c" },
      { from: "b", to: "a" },
    ]);
    expect(initial.dependencies).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]);
  });
  it("rejects incompatible check drops and ambiguous group or branch moves", () => {
    const initial = chain();
    expect(() => semanticDrop(initial, "c", { stepId: "a", placement: "before" })).toThrow(
      /Check steps/,
    );
    const parallel = setParallelGroup(
      parseLoop({ ...initial, dependencies: [] }),
      ["a", "b"],
      "Reviews",
    );
    expect(parallel.groups[0]?.kind).toBe("parallel");
    expect(() => semanticDrop(parallel, "a", { stepId: "c", placement: "before" })).toThrow(
      /group/,
    );
    const assigned = assignStepToGroup(parallel, "c", parallel.groups[0]!.id);
    expect(assigned.groups[0]?.stepIds).toEqual(["a", "b", "c"]);
    expect(() => assignStepToGroup(assigned, "c", parallel.groups[0]!.id)).toThrow(/one group/);
  });
  it("validates joins, decisions and bounded repeats against actual graph references", () => {
    const initial = parseLoop({ ...chain(), dependencies: [] });
    expect(() => setJoin(initial, "c", ["a"], "all")).toThrow(/two distinct/);
    const joined = setJoin(initial, "c", ["a", "b"], "all");
    expect(joined.dependencies).toHaveLength(2);
    expect(() =>
      setDecision(joined, "a", [
        { outcome: "yes", to: "b" },
        { outcome: "yes", to: "c" },
      ]),
    ).toThrow(/outcome/);
    expect(() =>
      setRepeatGroup(
        initial,
        ["a"],
        "Repair",
        0,
        { stepId: "a", outcome: "pass", to: "c" },
        { outcome: "retry", to: "a" },
      ),
    ).toThrow(/limit/);
    const repeated = setRepeatGroup(
      initial,
      ["a"],
      "Repair",
      2,
      { stepId: "a", outcome: "pass", to: "c" },
      { outcome: "retry", to: "a" },
    );
    expect(repeated.groups[0]).toMatchObject({ kind: "repeat", maxIterations: 2 });
    expect(repeated.decisions[0]?.branches).toHaveLength(2);
    expect(repeated.dependencies).toEqual([{ from: "a", to: "c" }]);
    expect(removeGroup(repeated, repeated.groups[0]!.id).decisions).toEqual([]);
  });
  it("undoes and redoes immutable editor states", () => {
    const initial = chain();
    const moved = semanticDrop(initial, "b", { stepId: "a", placement: "before" });
    const next = commit({ present: initial, past: [], future: [] }, moved);
    expect(undo(next).present).toEqual(initial);
    expect(redo(undo(next)).present).toEqual(moved);
  });
});
