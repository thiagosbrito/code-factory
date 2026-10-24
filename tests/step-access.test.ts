import { describe, expect, it } from "vitest";
import {
  isAnalyticalStep,
  isReadOnlyAgentStep,
  readOnlyRole,
  stepWritesProject,
} from "../src/domain/step-access.js";

type Step = Parameters<typeof stepWritesProject>[0];
const agent = (stage?: NonNullable<Step["stage"]>): Step => ({ kind: "agent", stage });

describe("portable step access policy", () => {
  it("makes evidence, planning and review agent steps read-only", () => {
    for (const stage of ["evidence", "planning", "review"] as const) {
      expect(isReadOnlyAgentStep(agent(stage))).toBe(true);
      expect(stepWritesProject(agent(stage))).toBe(false);
    }
  });

  it("keeps implementation, validation and stage-less agent steps writable", () => {
    for (const step of [agent("implementation"), agent("validation"), agent()]) {
      expect(isReadOnlyAgentStep(step)).toBe(false);
      expect(stepWritesProject(step)).toBe(true);
    }
  });

  it("treats checks as neither agent writers nor read-only agents", () => {
    expect(stepWritesProject({ kind: "check", stage: "validation" })).toBe(false);
    expect(isReadOnlyAgentStep({ kind: "check", stage: "evidence" })).toBe(false);
  });

  it("separates analytical steps from reviews and names each role", () => {
    expect(isAnalyticalStep(agent("evidence"))).toBe(true);
    expect(isAnalyticalStep(agent("planning"))).toBe(true);
    expect(isAnalyticalStep(agent("review"))).toBe(false);
    expect(readOnlyRole(agent("evidence"))).toBe("Evidence step");
    expect(readOnlyRole(agent("planning"))).toBe("Planning step");
    expect(readOnlyRole(agent("review"))).toBe("Reviewer");
    expect(readOnlyRole({ kind: "check" })).toBe("Check");
  });
});
