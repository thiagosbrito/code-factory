import { describe, expect, it } from "vitest";
import { parseLoop, type LoopDefinition } from "../src/domain/loop.js";
import { addDependency } from "../src/ui/features/loops/loop-editor-dependencies.js";
import { edge, repeated } from "./support/loop-editor-builders.js";

const repeatGroup = (loop: LoopDefinition) => {
  const group = loop.groups[0];
  if (group?.kind !== "repeat") throw new Error("Expected a repeat group");
  return group;
};

describe("adding a dependency beside a repeat group", () => {
  it.each([
    ["a", "e"],
    ["a", "d"],
    ["d", "e"],
  ])("accepts add %s -> %s and leaves the repeat policy untouched", (from, to) => {
    const loop = repeated();
    const before = structuredClone(loop);
    const next = addDependency(loop, from, to);
    expect(next.dependencies).toContainEqual(edge(from, to));
    expect(parseLoop(next)).toEqual(next);
    expect(loop).toEqual(before);
    const group = repeatGroup(next);
    const original = repeatGroup(loop);
    expect(group.exitWhen).toEqual(original.exitWhen);
    expect(group.continueWhen).toEqual(original.continueWhen);
    expect(group.stepIds).toEqual(original.stepIds);
    expect(group.maxIterations).toEqual(original.maxIterations);
    expect(next.groups).toEqual(loop.groups);
    expect(next.decisions).toEqual(loop.decisions);
  });
});
