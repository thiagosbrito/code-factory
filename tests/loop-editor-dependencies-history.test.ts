import { describe, expect, it } from "vitest";
import {
  addDependency,
  removeDependency,
  setStage,
} from "../src/ui/features/loops/loop-editor-dependencies.js";
import { commit, redo, undo, type History } from "../src/ui/features/loops/loop-editor-model.js";
import {
  build,
  chain,
  cycleMessage,
  decided,
  joined,
  parallel,
  repeated,
} from "./support/loop-editor-builders.js";

const groupMessage = "This step belongs to a group, join, or decision.";

describe("dependency history", () => {
  it("restores the exact previous dependency list through undo and redo", () => {
    const initial = chain();
    const start: History = { present: initial, past: [], future: [] };
    const added = commit(start, addDependency(initial, "a", "c"));
    expect(undo(added).present.dependencies).toEqual(initial.dependencies);
    const removed = commit(added, removeDependency(added.present, "a", "b"));
    expect(undo(removed).present.dependencies).toEqual(added.present.dependencies);
    expect(redo(undo(removed)).present.dependencies).toEqual(removed.present.dependencies);
  });

  it("leaves history identical when a rejected add reaches commit", () => {
    const initial = chain();
    const history: History = { present: initial, past: [], future: [] };
    const snapshot = structuredClone(history);
    expect(() => commit(history, addDependency(history.present, "c", "a"))).toThrow(
      new Error(cycleMessage),
    );
    expect(history).toEqual(snapshot);
  });
});

describe("setStage", () => {
  it("changes only the stage", () => {
    const loop = chain();
    const next = setStage(loop, "b", "review");
    expect(next.steps.find((s) => s.id === "b")?.stage).toBe("review");
    expect(next.dependencies).toEqual(loop.dependencies);
    expect(next.steps.map((s) => s.id)).toEqual(loop.steps.map((s) => s.id));
    expect(next.steps.filter((s) => s.id !== "b")).toEqual(loop.steps.filter((s) => s.id !== "b"));
  });

  it("moves an agent step into Validate", () => {
    expect(setStage(chain(), "a", "validation").steps[0]?.stage).toBe("validation");
  });

  it("is a no-op for the current stage", () => {
    const loop = chain();
    expect(setStage(loop, "a", "implementation")).toBe(loop);
  });

  it("treats a check step without a stored stage as being in Validate", () => {
    const loop = build(["a", "b"], { checks: ["b"], unstaged: ["b"] });
    expect(loop.steps[1]?.stage).toBeUndefined();
    expect(setStage(loop, "b", "validation")).toBe(loop);
    expect(() => setStage(loop, "b", "review")).toThrow(
      new Error("Check steps belong in Validate."),
    );
  });

  it.each([
    [
      "check step outside Validate",
      () => build(["a", "b"], { checks: ["b"] }),
      "b",
      "Check steps belong in Validate.",
    ],
    ["parallel group member", parallel, "b", groupMessage],
    ["repeat group member", repeated, "b", groupMessage],
    ["join step", joined, "d", groupMessage],
    ["decision step", decided, "a", groupMessage],
    ["missing step", chain, "nope", "Select an existing step."],
  ] as const)("refuses a %s", (_name, make, id, message) => {
    const loop = make();
    const before = structuredClone(loop);
    expect(() => setStage(loop, id, "review")).toThrow(message);
    expect(loop).toEqual(before);
  });

  it("restores the stage on undo and redo", () => {
    const initial = build(["a", "b"], { checks: ["b"] });
    const start: History = { present: initial, past: [], future: [] };
    const moved = commit(start, setStage(initial, "a", "planning"));
    expect(undo(moved).present).toEqual(initial);
    expect(redo(undo(moved)).present.steps[0]?.stage).toBe("planning");
  });
});
