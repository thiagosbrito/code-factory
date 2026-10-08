import { describe, expect, it } from "vitest";
import { declaredOutcome, firstLineOutcome } from "../src/domain/outcome.js";

describe("first-line outcomes", () => {
  it.each([
    ["pass\n\nAll six reviews returned pass.", "pass"],
    ["**pass**\nDetails", "pass"],
    ["`repair`", "repair"],
    ["Verdict: changes-requested.\n- Fix the label", "changes-requested"],
    ["# Pass", "pass"],
    ["  Blocked!  ", "blocked"],
  ])("reads %j as %s", (output, expected) => {
    expect(firstLineOutcome(output)).toBe(expected);
  });

  it("names a declared outcome only when the first line is one of them", () => {
    expect(declaredOutcome("pass\n\nreasons", ["pass", "repair"])).toBe("pass");
    expect(declaredOutcome("I think it passes", ["pass", "repair"])).toBeNull();
    expect(declaredOutcome("", ["pass", "repair"])).toBeNull();
  });
});
