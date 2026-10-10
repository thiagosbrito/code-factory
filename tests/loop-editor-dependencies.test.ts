import { describe, expect, it } from "vitest";
import { parseLoop, type LoopDefinition } from "../src/domain/loop.js";
import {
  addDependency,
  removeDependency,
} from "../src/ui/features/loops/loop-editor-dependencies.js";
import {
  build,
  chain,
  cycleMessage,
  decided,
  decisionParts,
  edge,
  joinParts,
  joined,
  parallel,
  parallelParts,
  repeated,
} from "./support/loop-editor-builders.js";

const decisionSource = (id: string) =>
  `Step ${id} is a decision. Add a named branch to its decision instead of a plain connection.`;
const tooFew = (from: string, to: string, outcomes: string, plural = false) =>
  `Removing ${from} to ${to} removes outcome${plural ? "s" : ""} ${outcomes} and leaves fewer than two branches on decision ${from}. Remove the decision first to disconnect this step.`;
const parallelMessage = "Parallel group g cannot order its members.";

type Base = {
  name: string;
  loop: () => LoopDefinition;
  op: "add" | "remove";
  from: string;
  to: string;
};
type AcceptRow = Base & { expected: (loop: LoopDefinition) => void };
type RejectRow = Base & { error: string };

const run = (loop: LoopDefinition, row: Base): LoopDefinition =>
  row.op === "add"
    ? addDependency(loop, row.from, row.to)
    : removeDependency(loop, row.from, row.to);

/** Accept rows of the THI-43 spike table plus the join/decision bookkeeping done in the same parse. */
const accepted: AcceptRow[] = [
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
    expected: (l) => expect(l.joins).toEqual([{ stepId: "d", from: ["b", "c", "a"], mode: "all" }]),
  },
  {
    name: "third source into an any-join keeps its mode",
    loop: () =>
      build(["a", "b", "c", "d"], {
        dependencies: [edge("b", "d"), edge("c", "d")],
        joins: [{ stepId: "d", from: ["b", "c"], mode: "any" }],
      }),
    op: "add",
    from: "a",
    to: "d",
    expected: (l) => expect(l.joins).toEqual([{ stepId: "d", from: ["b", "c", "a"], mode: "any" }]),
  },
  {
    name: "outgoing edge from a join target",
    loop: () => build(["a", "b", "c", "d", "e"], joinParts),
    op: "add",
    from: "d",
    to: "e",
    expected: (l) => expect(l.joins).toEqual([{ stepId: "d", from: ["b", "c"], mode: "all" }]),
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
    name: "remove a join source while two remain keeps the mode",
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
  {
    name: "two outcomes sharing one target are accepted and both removed with it",
    loop: () =>
      build(["a", "b", "c", "d"], {
        dependencies: [edge("a", "b"), edge("a", "c"), edge("a", "d")],
        decisions: [
          {
            stepId: "a",
            branches: [
              { outcome: "yes", to: "b" },
              { outcome: "maybe", to: "b" },
              { outcome: "x", to: "c" },
              { outcome: "y", to: "d" },
            ],
          },
        ],
      }),
    op: "remove",
    from: "a",
    to: "b",
    expected: (l) => expect(l.decisions[0]?.branches.map((b) => b.outcome)).toEqual(["x", "y"]),
  },
  {
    name: "edge that is both a decision branch and a join source updates both",
    loop: () =>
      build(["a", "b", "c", "d", "x"], {
        dependencies: [edge("a", "b"), edge("a", "c"), edge("a", "d"), edge("x", "c")],
        decisions: [
          {
            stepId: "a",
            branches: [
              { outcome: "yes", to: "b" },
              { outcome: "no", to: "c" },
              { outcome: "maybe", to: "d" },
            ],
          },
        ],
        joins: [{ stepId: "c", from: ["a", "x"], mode: "all" }],
      }),
    op: "remove",
    from: "a",
    to: "c",
    expected: (l) => {
      expect(l.decisions[0]?.branches.map((b) => b.outcome)).toEqual(["yes", "maybe"]);
      expect(l.joins).toEqual([]);
      expect(l.dependencies).toEqual([edge("a", "b"), edge("a", "d"), edge("x", "c")]);
    },
  },
  {
    name: "remove an edge beside the repeat continuation keeps the continuation branch",
    loop: () =>
      build(["a", "b", "c", "d"], {
        dependencies: [edge("a", "c"), edge("c", "d"), edge("c", "b")],
        groups: [
          {
            id: "g",
            name: "G",
            kind: "repeat",
            stepIds: ["c", "b"],
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
              { outcome: "alt", to: "b" },
            ],
          },
        ],
      }),
    op: "remove",
    from: "c",
    to: "b",
    expected: (l) => {
      expect(l.decisions[0]?.branches).toEqual([
        { outcome: "done", to: "d" },
        { outcome: "again", to: "b" },
      ]);
      expect(l.groups[0]).toMatchObject({ continueWhen: { outcome: "again", to: "b" } });
      expect(l.dependencies).toEqual([edge("a", "c"), edge("c", "d")]);
    },
  },
];

/** Reject rows: the exact message is pinned. A rejected call throws and the loop is unchanged. */
const rejected: RejectRow[] = [
  { name: "self edge", loop: chain, op: "add", from: "a", to: "a", error: cycleMessage },
  {
    name: "self edge on a join target",
    loop: () => build(["a", "b", "c", "d"], joinParts),
    op: "add",
    from: "d",
    to: "d",
    error: cycleMessage,
  },
  {
    name: "back edge closing a cycle",
    loop: chain,
    op: "add",
    from: "c",
    to: "a",
    error: cycleMessage,
  },
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
    name: "edge from a missing step",
    loop: chain,
    op: "add",
    from: "nope",
    to: "a",
    error: "Select two existing steps.",
  },
  {
    name: "new outgoing edge from a decision step",
    loop: decided,
    op: "add",
    from: "a",
    to: "d",
    error: decisionSource("a"),
  },
  {
    name: "remove a branch edge leaving fewer than two branches",
    loop: decided,
    op: "remove",
    from: "a",
    to: "c",
    error: tooFew("a", "c", "no"),
  },
  {
    name: "remove an edge carrying several outcomes of a three-branch decision",
    loop: () =>
      build(["a", "b", "c"], {
        dependencies: [edge("a", "b"), edge("a", "c")],
        decisions: [
          {
            stepId: "a",
            branches: [
              { outcome: "yes", to: "b" },
              { outcome: "maybe", to: "b" },
              { outcome: "no", to: "c" },
            ],
          },
        ],
      }),
    op: "remove",
    from: "a",
    to: "b",
    error: tooFew("a", "b", "yes, maybe", true),
  },
  {
    name: "edge between two parallel members",
    loop: parallel,
    op: "add",
    from: "b",
    to: "c",
    error: parallelMessage,
  },
  {
    name: "reverse edge between two parallel members",
    loop: parallel,
    op: "add",
    from: "c",
    to: "b",
    error: parallelMessage,
  },
  {
    name: "repeat continuation drawn as an edge",
    loop: repeated,
    op: "add",
    from: "c",
    to: "b",
    error: decisionSource("c"),
  },
  {
    name: "third outgoing edge from the repeat exit decision",
    loop: repeated,
    op: "add",
    from: "c",
    to: "e",
    error: decisionSource("c"),
  },
  {
    name: "remove the repeat exit edge",
    loop: repeated,
    op: "remove",
    from: "c",
    to: "d",
    error: tooFew("c", "d", "done"),
  },
  {
    name: "remove the exit edge of a three-branch repeat decision is refused by parseLoop",
    loop: () =>
      build(["a", "b", "c", "d", "e"], {
        dependencies: [edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("c", "e")],
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
              { outcome: "other", to: "e" },
            ],
          },
        ],
      }),
    op: "remove",
    from: "c",
    to: "d",
    error: "Repeat g needs an exit decision leading outside its body.",
  },
  {
    name: "edge closing a loop outside the body",
    loop: repeated,
    op: "add",
    from: "d",
    to: "a",
    error: cycleMessage,
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

describe("dependency operations", () => {
  it.each(accepted)("accepts $op $from -> $to: $name", (row) => {
    const loop = row.loop();
    const before = structuredClone(loop);
    const next = run(loop, row);
    row.expected(next);
    expect(parseLoop(next)).toEqual(next);
    expect(loop).toEqual(before);
    expect(next.groups.map(({ id }) => id)).toEqual(loop.groups.map(({ id }) => id));
  });

  it.each(rejected)("rejects $op $from -> $to: $name", (row) => {
    const loop = row.loop();
    const before = structuredClone(loop);
    expect(() => run(loop, row)).toThrow(new Error(row.error));
    expect(loop).toEqual(before);
  });

  it("rejects a duplicate edge without changing the loop", () => {
    const loop = chain();
    const before = structuredClone(loop);
    expect(() => addDependency(loop, "a", "b")).toThrow(
      new Error("Step a already leads to step b."),
    );
    expect(loop).toEqual(before);
    expect(loop.dependencies.filter((e) => e.from === "a" && e.to === "b")).toHaveLength(1);
  });

  it("leaves continueWhen unchanged after an allowed removal", () => {
    const loop = repeated();
    const next = removeDependency(loop, "a", "b");
    expect(next.dependencies).toEqual([edge("b", "c"), edge("c", "d")]);
    expect(next.groups).toEqual(loop.groups);
    expect(next.decisions).toEqual(loop.decisions);
  });
});
