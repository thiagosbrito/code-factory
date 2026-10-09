// @vitest-environment jsdom
import { createLoopDraft, parseLoop, type LoopDefinition } from "../../src/domain/loop.js";
import { type ProjectResponse } from "../../src/ui/shared/project-api.js";
import { trustState } from "../fixtures/trust.js";

export const project: ProjectResponse = {
  project: { schemaVersion: 1, name: "Project", defaultBinding: null },
  path: "/project",
  revision: "one",
  trust: trustState(),
};

export function draft(): LoopDefinition {
  return parseLoop({
    ...createLoopDraft("sample", "Sample"),
    steps: [
      {
        id: "build",
        name: "Build",
        kind: "agent",
        stage: "implementation",
        role: "Builder",
        instruction: "Build it",
        expectedOutputs: ["Patch"],
      },
      {
        id: "review",
        name: "Review",
        kind: "agent",
        stage: "review",
        role: "Reviewer",
        instruction: "Review it",
        expectedOutputs: ["Receipt"],
      },
    ],
    dependencies: [{ from: "build", to: "review" }],
  });
}
