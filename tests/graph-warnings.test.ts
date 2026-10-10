import type { LoopDefinition } from "../src/domain/loop.js";
import { describe, expect, it } from "vitest";
import { planDrops } from "../src/ui/features/loops/graph/graph-actions.js";
import { laneOriginX } from "../src/ui/features/loops/graph/graph-layout.js";
import { changeWarnings } from "../src/ui/features/loops/graph/graph-warnings.js";
import { build, chain, edge, joined, structured } from "./support/loop-editor-builders.js";

const disconnect = (...pairs: [string, string][]) => ({
  kind: "disconnect" as const,
  edges: pairs.map(([source, target]) => ({ source, target })),
});

/** Three outcomes, two of which (yes, maybe) share the target b. */
const sharedOutcomes = () =>
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
  });

describe("warnings before removing a connection", () => {
  it("warns that a join falling below two sources is removed, and that waits-for-any is not restored", () => {
    const warnings = changeWarnings(structured(), disconnect(["b", "j"]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("fewer than two sources");
    expect(warnings[0]).toContain("waits for any");
    expect(warnings[0]).toContain("waits for all, not for any");
  });

  it("warns for a waits-for-all join too, without the mode caveat", () => {
    const warnings = changeWarnings(joined(), disconnect(["b", "d"]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("join d");
    expect(warnings[0]).not.toContain("not for any");
  });

  it("does not warn while a join keeps two sources", () => {
    const loop = build(["a", "b", "c", "d"], {
      dependencies: [edge("a", "d"), edge("b", "d"), edge("c", "d")],
      joins: [{ stepId: "d", from: ["a", "b", "c"], mode: "any" }],
    });
    expect(changeWarnings(loop, disconnect(["a", "d"]))).toEqual([]);
  });

  it("warns when removing a shared-target connection still leaves two or more branches", () => {
    const loop = build(["a", "b", "c", "d"], {
      dependencies: [edge("a", "b"), edge("a", "c"), edge("a", "d")],
      decisions: [
        {
          stepId: "a",
          branches: [
            { outcome: "yes", to: "b" },
            { outcome: "maybe", to: "b" },
            { outcome: "no", to: "c" },
            { outcome: "never", to: "d" },
          ],
        },
      ],
    });
    const warnings = changeWarnings(loop, disconnect(["a", "b"]));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("2 decision outcomes");
    expect(warnings[0]).toContain("yes, maybe");
  });

  it("does not warn for a single outcome", () => {
    const loop = build(["a", "b", "c", "d"], {
      dependencies: [edge("a", "b"), edge("a", "c"), edge("a", "d")],
      decisions: [
        {
          stepId: "a",
          branches: [
            { outcome: "yes", to: "b" },
            { outcome: "no", to: "c" },
            { outcome: "never", to: "d" },
          ],
        },
      ],
    });
    expect(changeWarnings(loop, disconnect(["a", "d"]))).toEqual([]);
  });

  it("has nothing to warn about when the model refuses the removal, so the refusal is shown instead", () => {
    // Removing a branch that leaves fewer than two is refused by the model.
    expect(changeWarnings(sharedOutcomes(), disconnect(["a", "c"]))).toEqual([]);
    expect(changeWarnings(chain(), disconnect(["a", "c"]))).toEqual([]);
  });

  it("warns once per affected connection when several are removed together", () => {
    const loop = build(["a", "b", "c", "d", "e", "f"], {
      dependencies: [edge("a", "c"), edge("b", "c"), edge("d", "f"), edge("e", "f")],
      joins: [
        { stepId: "c", from: ["a", "b"], mode: "all" },
        { stepId: "f", from: ["d", "e"], mode: "any" },
      ],
    });
    expect(changeWarnings(loop, disconnect(["a", "c"], ["d", "f"]))).toHaveLength(2);
  });
});

describe("warnings before moving a step to another lane", () => {
  const drop = (id: string, lane: "review" | "validation" | "implementation") => {
    const loop = structured();
    const drops = planDrops(loop, [{ id, position: { x: laneOriginX(lane) + 16, y: 400 } }]);
    return { loop, drops };
  };

  it("warns when a step enters the Review lane because the scheduler treats review steps specially", () => {
    const { loop, drops } = drop("y1", "review");
    const warnings = changeWarnings(loop, { kind: "drop", drops });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("into the Review lane");
    expect(warnings[0]).toContain("only reads the workspace");
    expect(warnings[0]).toContain("alongside other reviews");
    expect(warnings[0]).toContain("changes-requested outcome ends the run as rejected");
    expect(warnings[0]).toContain("unless a repeat group continues it");
  });

  it("warns when a step leaves the Review lane", () => {
    const loop = build(["a", "b"], { dependencies: [edge("a", "b")] });
    const reviewed = {
      ...loop,
      steps: loop.steps.map((item) =>
        item.id === "b" ? { ...item, stage: "review" as const } : item,
      ),
    };
    const drops = planDrops(reviewed, [
      { id: "b", position: { x: laneOriginX("implementation") + 16, y: 400 } },
    ]);
    const warnings = changeWarnings(reviewed, { kind: "drop", drops });
    expect(warnings[0]).toContain("out of the Review lane");
    expect(warnings[0]).toContain("may write to the workspace");
    expect(warnings[0]).toContain("runs on its own");
    expect(warnings[0]).toContain("no longer rejects the run");
  });

  const chain = () => build(["a", "b", "c"], { dependencies: [edge("a", "b"), edge("b", "c")] });
  const into = (
    loop: LoopDefinition,
    id: string,
    lane: "validation" | "review" | "implementation",
  ) =>
    changeWarnings(loop, {
      kind: "drop",
      drops: planDrops(loop, [{ id, position: { x: laneOriginX(lane) + 16, y: 400 } }]),
    });
  const staged = (loop: LoopDefinition, id: string, stage: "validation" | "review") => ({
    ...loop,
    steps: loop.steps.map((item) => (item.id === id ? { ...item, stage } : item)),
  });

  it("warns when an agent step with indirect ancestors enters or leaves Validate", () => {
    const entering = into(chain(), "c", "validation");
    expect(entering).toHaveLength(1);
    expect(entering[0]).toContain("into the Validate lane");
    expect(entering[0]).toContain("results of every upstream step on the same candidate");
    const leaving = into(staged(chain(), "c", "validation"), "c", "implementation");
    expect(leaving).toHaveLength(1);
    expect(leaving[0]).toContain("out of the Validate lane");
    expect(leaving[0]).toContain("stops receiving");
  });

  it("does not warn about inputs when the step has only direct dependencies or none", () => {
    // b's only ancestor is its direct dependency a; a has no ancestors: the lane changes nothing.
    const direct = build(["a", "b"], { dependencies: [edge("a", "b")] });
    expect(into(direct, "b", "validation")).toEqual([]);
    expect(into(direct, "a", "validation")).toEqual([]);
    // Review still explains what a review step is, without the inputs sentence.
    const review = into(direct, "b", "review");
    expect(review).toHaveLength(1);
    expect(review[0]).toContain("into the Review lane");
    expect(review[0]).not.toContain("upstream");
  });

  it("adds the inputs sentence when a move into Review gains upstream results, and not between Review and Validate", () => {
    const gained = into(chain(), "c", "review");
    expect(gained).toHaveLength(1);
    expect(gained[0]).toContain("It also receives the results of every upstream step");
    const across = into(staged(chain(), "c", "review"), "c", "validation");
    expect(across).toHaveLength(1);
    expect(across[0]).toContain("out of the Review lane");
    expect(across[0]).not.toContain("upstream");
  });

  it("does not warn for a move between lanes that treat inputs alike, or within a lane", () => {
    const loop = chain();
    const toPlan = planDrops(loop, [
      { id: "c", position: { x: laneOriginX("planning") + 16, y: 400 } },
    ]);
    expect(changeWarnings(loop, { kind: "drop", drops: toPlan })).toEqual([]);
    const within = planDrops(loop, [
      { id: "c", position: { x: laneOriginX("implementation") + 16, y: 600 } },
    ]);
    expect(changeWarnings(loop, { kind: "drop", drops: within })).toEqual([]);
  });

  it("does not warn when the move itself would be refused", () => {
    // z is a decision: it may not change lane, and the refusal is shown instead of a confirmation.
    const { loop, drops } = drop("z", "review");
    expect(changeWarnings(loop, { kind: "drop", drops })).toEqual([]);
  });
});
