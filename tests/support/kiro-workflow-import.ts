import { readFile } from "node:fs/promises";
import { expect } from "vitest";
import { createLoopDraft, type LoopDefinition } from "../../src/domain/loop.js";
import { TranslationError } from "../../src/translators/contract.js";
import { kiroWorkflowTranslator } from "../../src/translators/kiro-workflow.js";

export const fixture = (name: string) =>
  readFile(new URL(`../fixtures/kiro/${name}`, import.meta.url), "utf8");

export const step = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "step",
  id,
  agent: "wf-coder",
  prompt: `${id} step.`,
  ...extra,
});

export const workflowText = (steps: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "Inline", inputs: {}, steps, ...extra });

export const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected a TranslationError.");
};

/** Returns the message of the TranslationError thrown by `run`. */
export const failure = (run: () => unknown): string => {
  const error = thrownBy(run);
  expect(error).toBeInstanceOf(TranslationError);
  return error instanceof Error ? error.message : String(error);
};

export const repeat = (id: string, steps: unknown[], extra: Record<string, unknown> = {}) => ({
  type: "repeat",
  id,
  maxIterations: 2,
  onMaxIterations: "abort",
  steps,
  ...extra,
});

export const blankDraft = () => createLoopDraft("native", "Native");

export const importText = (content: string) => kiroWorkflowTranslator.import(content, blankDraft());

export const edges = (loop: LoopDefinition) =>
  loop.dependencies.map(({ from, to }) => `${from}→${to}`).sort();

export const joinsOf = (loop: LoopDefinition) =>
  [...loop.joins].sort((a, b) => a.stepId.localeCompare(b.stepId));

export const stepOf = (loop: LoopDefinition, id: string) => {
  const found = loop.steps.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing step ${id}`);
  return found;
};
