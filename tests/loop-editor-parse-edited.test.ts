import { describe, expect, it } from "vitest";
import { parseEdited } from "../src/ui/features/loops/loop-editor-dependencies.js";
import { chain, edge } from "./support/loop-editor-builders.js";

describe("parseEdited", () => {
  it("dedupes repeated issues into one readable message", () => {
    const loop = chain();
    expect(() =>
      parseEdited({ ...loop, dependencies: [edge("a", "b"), edge("a", "b"), edge("a", "b")] }),
    ).toThrow(new Error("Dependencies must be unique."));
  });

  it("joins distinct issues with the controller's separator", () => {
    const loop = chain();
    expect(() =>
      parseEdited({ ...loop, dependencies: [edge("a", "b"), edge("a", "b"), edge("c", "nope")] }),
    ).toThrow(
      new Error("Dependencies must be unique.; Dependencies must reference existing steps."),
    );
  });

  it("rethrows errors that are not validation failures unchanged", () => {
    const boom = new Error("boom");
    const input = {};
    Object.defineProperty(input, "schemaVersion", {
      enumerable: true,
      get: () => {
        throw boom;
      },
    });
    expect(() => parseEdited(input)).toThrow(boom);
  });
});
