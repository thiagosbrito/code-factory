import { describe, expect, it } from "vitest";
import { createLoopDraft, parseLoop, type LoopDefinition } from "../src/domain/loop.js";
import {
  addDependency,
  removeDependency,
  setStage,
} from "../src/ui/features/loops/loop-editor-dependencies.js";
import { commit, redo, undo, type History } from "../src/ui/features/loops/loop-editor-model.js";

const cycle = "Dependency cycles are not allowed; repairs require explicit bounded policy.";
const decisionSource =
  "Step a is a decision. Add a named branch to its decision instead of a plain connection.";
const repeatSource =
  "Step c is a decision. Add a named branch to its decision instead of a plain connection.";
const fewBranches = (id: string) =>
  `Decision ${id} needs at least two branches. Remove the decision first to disconnect this step.`;
const groupMessage = "This step belongs to a group, join, or decision.";

type Parts = Partial<Pick<LoopDefinition, "dependencies" | "groups" | "joins" | "decisions">> & {
  grouped?: Record<string, string>;
  checks?: string[];
};

const build = (ids: string[], parts: Parts = {}): LoopDefinition =>
  parseLoop({
    ...createLoopDraft("example", "Example"),
    steps: ids.map((id) => ({
      id,
      name: id,
      kind: parts.checks?.includes(id) ? "check" : "agent",
      stage: parts.checks?.includes(id) ? "validation" : "implementation",
      role: "Role",
      instruction: "Do it",
      expectedOutputs: ["Result"],
      groupId: parts.grouped?.[id],
    })),
    dependencies: parts.dependencies ?? [],
    groups: parts.groups ?? [],
    joins: parts.joins ?? [],
    decisions: parts.decisions ?? [],
  });

const edge = (from: string, to: string) => ({ from, to });
const chain = () => build(["a", "b", "c"], { dependencies: [edge("a", "b"), edge("b", "c")] });

const joinParts: Parts = {
  dependencies: [edge("b", "d"), edge("c", "d")],
  joins: [{ stepId: "d", from: ["b", "c"], mode: "all" }],
};
const joined = () =>
  build(["a", "b", "c", "d"], {
    ...joinParts,
    dependencies: [edge("a", "b"), edge("a", "c"), ...(joinParts.dependencies ?? [])],
  });

const decisionParts: Parts = {
  dependencies: [edge("a", "b"), edge("a", "c")],
  decisions: [
    {
      stepId: "a",
      branches: [
        { outcome: "yes", to: "b" },
        { outcome: "no", to: "c" },
      ],
    },
  ],
};
const decided = () => build(["a", "b", "c", "d"], decisionParts);

const parallelParts: Parts = {
  dependencies: [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")],
  groups: [{ id: "g", name: "G", kind: "parallel", stepIds: ["b", "c"] }],
  grouped: { b: "g", c: "g" },
};
const parallel = () => build(["a", "b", "c", "d"], parallelParts);

const repeated = () =>
  build(["a", "b", "c", "d", "e"], {
    dependencies: [edge("a", "b"), edge("b", "c"), edge("c", "d")],
    groups: [
      {
        id: "g",
        name: "G",
        kind: "repeat",
        stepIds: ["b", "c"],
        maxIterations: 3,
        exitWhen: { stepId: "c", outcome: "done" },
        continueWhen: { outcome: "again", to: "b" },
      },
    ],
    grouped: { b: "g", c: "g" },
    decisions: [
      {
        stepId: "c",
        branches: [
          { outcome: "done", to: "d" },
          { outcome: "again", to: "b" },
        ],
      },
    ],
  });

type Case = {
  name: string;
  loop: () => LoopDefinition;
  op: "add" | "remove";
  from: string;
  to: string;
  error?: string;
  expected?: (loop: LoopDefinition) => void;
};

/** The accept/reject table for addDependency and removeDependency (mirrors the THI-43 spike note). */
const cases: Case[] = [
  // Accept rows.
  {
    name: "plain skip edge",
    loop: chain,
    op: "add",
    from: "a",
    to: "c",
    expected: (l) => expect(l.dependencies).toContainEqual(edge("a", "c")),
  },
  {
    name: "fan-out from a plain step",
    loop: () => build(["a", "b", "c"], { dependencies: [edge("a", "b")] }),
    op: "add",
    from: "a",
    to: "c",
    expected: (l) => expect(l.dependencies).toEqual([edge("a", "b"), edge("a", "c")]),
  },
  {
    name: "fan-in without a join record",
    loop: () => build(["a", "b", "c"], { dependencies: [edge("a", "c")] }),
    op: "add",
    from: "b",
    to: "c",
    expected: (l) => {
      expect(l.dependencies).toEqual([edge("a", "c"), edge("b", "c")]);
      expect(l.joins).toEqual([]);
    },
  },
  {
    name: "edge from a later lane to an earlier lane",
    loop: () => build(["a", "b"], { checks: ["a"] }),
    op: "add",
    from: "a",
    to: "b",
    expected: (l) => expect(l.dependencies).toEqual([edge("a", "b")]),
  },
  {
    name: "agent feeding a check",
    loop: () => build(["a", "b"], { checks: ["b"] }),
    op: "add",
    from: "a",
    to: "b",
    expected: (l) => expect(l.dependencies).toEqual([edge("a", "b")]),
  },
  {
    name: "third source into a join target updates join.from",
    loop: joined,
    op: "add",
    from: "a",
    to: "d",
    expected: (l) => expect(l.joins[0]?.from).toEqual(["b", "c", "a"]),
  },
  {
    name: "outgoing edge from a join target",
    loop: () => build(["a", "b", "c", "d", "e"], joinParts),
    op: "add",
    from: "d",
    to: "e",
    expected: (l) => expect(l.joins[0]?.from).toEqual(["b", "c"]),
  },
  {
    name: "incoming edge into a decision step",
    loop: () => build(["z", "a", "b", "c"], decisionParts),
    op: "add",
    from: "z",
    to: "a",
    expected: (l) => expect(l.decisions).toEqual(decided().decisions),
  },
  {
    name: "edge to one parallel member only",
    loop: () => build(["x", "a", "b", "c", "d"], parallelParts),
    op: "add",
    from: "x",
    to: "b",
    expected: (l) => expect(l.dependencies).toContainEqual(edge("x", "b")),
  },
  {
    name: "edge entering the middle of a repeat body",
    loop: repeated,
    op: "add",
    from: "a",
    to: "c",
    expected: (l) => expect(l.dependencies).toContainEqual(edge("a", "c")),
  },
  {
    name: "edge leaving a repeat body from a non-exit step",
    loop: repeated,
    op: "add",
    from: "b",
    to: "e",
    expected: (l) => expect(l.dependencies).toContainEqual(edge("b", "e")),
  },
  {
    name: "remove a plain edge",
    loop: chain,
    op: "remove",
    from: "a",
    to: "b",
    expected: (l) => expect(l.dependencies).toEqual([edge("b", "c")]),
  },
  {
    name: "remove a join source: join dropped below two sources, plain edge kept",
    loop: joined,
    op: "remove",
    from: "c",
    to: "d",
    expected: (l) => {
      expect(l.joins).toEqual([]);
      expect(l.dependencies).toContainEqual(edge("b", "d"));
    },
  },
  {
    name: "remove a join source while two remain",
    loop: () =>
      build(["a", "b", "c", "d"], {
        dependencies: [edge("a", "d"), edge("b", "d"), edge("c", "d")],
        joins: [{ stepId: "d", from: ["a", "b", "c"], mode: "any" }],
      }),
    op: "remove",
    from: "a",
    to: "d",
    expected: (l) => expect(l.joins).toEqual([{ stepId: "d", from: ["b", "c"], mode: "any" }]),
  },
  {
    name: "remove a decision branch while two remain",
    loop: () =>
      build(["a", "b", "c", "d"], {
        dependencies: [edge("a", "b"), edge("a", "c"), edge("a", "d")],
        decisions: [
          {
            stepId: "a",
            branches: [
              { outcome: "x", to: "b" },
              { outcome: "y", to: "c" },
              { outcome: "z", to: "d" },
            ],
          },
        ],
      }),
    op: "remove",
    from: "a",
    to: "d",
    expected: (l) => expect(l.decisions[0]?.branches.map((b) => b.to)).toEqual(["b", "c"]),
  },
  // Reject rows.
  { name: "self edge", loop: chain, op: "add", from: "a", to: "a", error: cycle },
  { name: "back edge closing a cycle", loop: chain, op: "add", from: "c", to: "a", error: cycle },
  {
    name: "duplicate edge",
    loop: chain,
    op: "add",
    from: "a",
    to: "b",
    error: "Step a already leads to step b.",
  },
  {
    name: "edge to a missing step",
    loop: chain,
    op: "add",
    from: "a",
    to: "nope",
    error: "Select two existing steps.",
  },
  {
    name: "new outgoing edge from a decision step",
    loop: decided,
    op: "add",
    from: "a",
    to: "d",
    error: decisionSource,
  },
  {
    name: "remove a branch edge leaving fewer than two branches",
    loop: decided,
    op: "remove",
    from: "a",
    to: "c",
    error: fewBranches("a"),
  },
  {
    name: "edge between two parallel members",
    loop: parallel,
    op: "add",
    from: "b",
    to: "c",
    error: "Parallel group g cannot order its members.",
  },
  {
    name: "reverse edge between two parallel members",
    loop: parallel,
    op: "add",
    from: "c",
    to: "b",
    error: "Parallel group g cannot order its members.",
  },
  {
    name: "repeat continuation drawn as an edge",
    loop: repeated,
    op: "add",
    from: "c",
    to: "b",
    error: repeatSource,
  },
  {
    name: "third outgoing edge from the repeat exit decision",
    loop: repeated,
    op: "add",
    from: "c",
    to: "e",
    error: repeatSource,
  },
  {
    name: "remove the repeat exit edge",
    loop: repeated,
    op: "remove",
    from: "c",
    to: "d",
    error: fewBranches("c"),
  },
  {
    name: "edge closing a loop outside the body",
    loop: repeated,
    op: "add",
    from: "d",
    to: "a",
    error: cycle,
  },
  {
    name: "remove an edge that does not exist",
    loop: chain,
    op: "remove",
    from: "a",
    to: "c",
    error: "Step a does not lead to step c.",
  },
];

const run = (loop: LoopDefinition, item: Case): LoopDefinition =>
  item.op === "add"
    ? addDependency(loop, item.from, item.to)
    : removeDependency(loop, item.from, item.to);

describe("dependency operations", () => {
  it.each(cases.filter((item) => item.error === undefined))(
    "accepts $op $from -> $to: $name",
    (item) => {
      const loop = item.loop();
      const before = structuredClone(loop);
      const next = run(loop, item);
      item.expected?.(next);
      expect(parseLoop(next)).toEqual(next);
      expect(loop).toEqual(before);
      expect(next.groups).toEqual(loop.groups);
    },
  );

  it.each(cases.filter((item) => item.error !== undefined))(
    "rejects $op $from -> $to: $name",
    (item) => {
      const loop = item.loop();
      const before = structuredClone(loop);
      expect(() => run(loop, item)).toThrow(item.error);
      expect(loop).toEqual(before);
    },
  );

  it("never duplicates an edge and never changes continueWhen", () => {
    const loop = repeated();
    const next = addDependency(loop, "a", "c");
    expect(new Set(next.dependencies.map((e) => `${e.from}:${e.to}`)).size).toBe(
      next.dependencies.length,
    );
    expect(next.groups).toEqual(loop.groups);
    expect(() => removeDependency(loop, "c", "d")).toThrow(fewBranches("c"));
  });

  it("restores the exact previous dependency list through undo and redo", () => {
    const initial = chain();
    const start: History = { present: initial, past: [], future: [] };
    const added = commit(start, addDependency(initial, "a", "c"));
    expect(undo(added).present.dependencies).toEqual(initial.dependencies);
    const removed = commit(added, removeDependency(added.present, "a", "b"));
    expect(undo(removed).present.dependencies).toEqual(added.present.dependencies);
    expect(redo(undo(removed)).present.dependencies).toEqual(removed.present.dependencies);
    expect(() => addDependency(removed.present, "c", "a")).toThrow(cycle);
    expect(removed.past).toHaveLength(2);
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

  it("is a no-op for the current stage", () => {
    const loop = chain();
    expect(setStage(loop, "a", "implementation")).toBe(loop);
  });

  it.each([
    [
      "check step outside Validate",
      () => build(["a", "b"], { checks: ["b"] }),
      "b",
      "Check steps belong in Validate.",
    ],
    ["group member", parallel, "b", groupMessage],
    ["join step", joined, "d", groupMessage],
    ["decision step", decided, "a", groupMessage],
    ["missing step", chain, "nope", "Select an existing step."],
  ] as const)("refuses a %s", (_name, make, id, message) => {
    const loop = make();
    const before = structuredClone(loop);
    expect(() => setStage(loop, id, "review")).toThrow(message);
    expect(loop).toEqual(before);
  });

  it("keeps a check step in Validate and restores the stage on undo and redo", () => {
    const initial = build(["a", "b"], { checks: ["b"] });
    expect(setStage(initial, "b", "validation")).toBe(initial);
    const start: History = { present: initial, past: [], future: [] };
    const moved = commit(start, setStage(initial, "a", "planning"));
    expect(undo(moved).present).toEqual(initial);
    expect(redo(undo(moved)).present.steps[0]?.stage).toBe("planning");
  });
});
