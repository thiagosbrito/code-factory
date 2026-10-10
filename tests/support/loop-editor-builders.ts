import { createLoopDraft, parseLoop, type LoopDefinition } from "../../src/domain/loop.js";

export const cycleMessage =
  "Dependency cycles are not allowed; repairs require explicit bounded policy.";

export type Parts = Partial<
  Pick<LoopDefinition, "dependencies" | "groups" | "joins" | "decisions">
> & {
  grouped?: Record<string, string>;
  checks?: string[];
  /** Step ids that omit `stage` entirely. */
  unstaged?: string[];
};

export const build = (ids: string[], parts: Parts = {}): LoopDefinition =>
  parseLoop({
    ...createLoopDraft("example", "Example"),
    steps: ids.map((id) => ({
      id,
      name: id,
      kind: parts.checks?.includes(id) ? "check" : "agent",
      stage: parts.unstaged?.includes(id)
        ? undefined
        : parts.checks?.includes(id)
          ? "validation"
          : "implementation",
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

export const edge = (from: string, to: string) => ({ from, to });

export const chain = () =>
  build(["a", "b", "c"], { dependencies: [edge("a", "b"), edge("b", "c")] });

export const joinParts: Parts = {
  dependencies: [edge("b", "d"), edge("c", "d")],
  joins: [{ stepId: "d", from: ["b", "c"], mode: "all" }],
};
export const joined = () =>
  build(["a", "b", "c", "d"], {
    ...joinParts,
    dependencies: [edge("a", "b"), edge("a", "c"), ...(joinParts.dependencies ?? [])],
  });

export const decisionParts: Parts = {
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
export const decided = () => build(["a", "b", "c", "d"], decisionParts);

export const parallelParts: Parts = {
  dependencies: [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")],
  groups: [{ id: "g", name: "G", kind: "parallel", stepIds: ["b", "c"] }],
  grouped: { b: "g", c: "g" },
};
export const parallel = () => build(["a", "b", "c", "d"], parallelParts);

const repeatGroup = {
  id: "g",
  name: "G",
  kind: "repeat",
  stepIds: ["b", "c"],
  maxIterations: 3,
  exitWhen: { stepId: "c", outcome: "done" },
  continueWhen: { outcome: "again", to: "b" },
} as const;

export const repeated = () =>
  build(["a", "b", "c", "d", "e"], {
    dependencies: [edge("a", "b"), edge("b", "c"), edge("c", "d")],
    groups: [{ ...repeatGroup, stepIds: ["b", "c"] }],
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
