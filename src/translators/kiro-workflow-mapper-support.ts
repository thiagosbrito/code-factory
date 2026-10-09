import type { LoopDefinition } from "../domain/loop.js";
import { boundedJson } from "./kiro-workflow-ids.js";
import { type KiroRepeat, type KiroStep, type KiroWorkflow } from "./kiro-workflow-schema.js";

export type LoopStep = LoopDefinition["steps"][number];
export type LoopGroup = LoopDefinition["groups"][number];
export type LoopDependency = LoopDefinition["dependencies"][number];
export type LoopJoin = LoopDefinition["joins"][number];
export type LoopDecision = LoopDefinition["decisions"][number];
export type LoopPolicy = LoopDefinition["policy"];
export type JoinMode = LoopJoin["mode"];
export type SourcePath = readonly PropertyKey[];

export type MappedKiroLoop = {
  name: string;
  steps: LoopStep[];
  dependencies: LoopDependency[];
  groups: LoopGroup[];
  joins: LoopJoin[];
  decisions: LoopDecision[];
};

/** Entry and exit step ids of a mapped Kiro node; empty when nothing was importable. */
export type Fragment = {
  entries: string[];
  exits: string[];
  exitMode?: JoinMode;
  exitPath?: SourcePath;
};
export type Context = { repeat?: { groupId: string; rawId: string } };
export type PendingRepeat = {
  node: KiroRepeat;
  path: SourcePath;
  groupId: string;
  order: number;
  stepIds: string[];
  entry: string;
  exit: string;
};

export const maxRepeatIterations = 10;
export const templatePattern = /\{\{[^{}]+\}\}/g;
export const emptyFragment = (): Fragment => ({ entries: [], exits: [] });
export const isEmpty = (fragment: Fragment): boolean => fragment.entries.length === 0;

/** The Kiro stop rule as instruction text, kept whole up to the `boundedJson` limit. */
export const describeStop = (node: KiroRepeat): ReturnType<typeof boundedJson> | undefined => {
  if (node.stopCondition) return boundedJson({ stopCondition: node.stopCondition });
  if (node.stopWhen !== undefined) return boundedJson({ stopWhen: node.stopWhen });
  return undefined;
};

export const decisionInstruction = (
  node: KiroRepeat,
  observed: string,
  stop: ReturnType<typeof describeStop>,
): string =>
  [
    `Importer-generated step: Code Factory added it to decide Kiro repeat "${node.id}". It is not part of the Kiro recipe.`,
    `Read the output of step "${observed}" in the inputs below, and any file the stop condition names, then decide whether the Kiro stop condition holds. Do not change files.`,
    'Reply with exactly one word: "stop" when the condition holds, otherwise "continue".',
    stop
      ? `Kiro stop condition (verbatim JSON):\n${stop.text}`
      : "Kiro stop condition: none (Kiro repeats until the round limit).",
  ].join("\n\n");

export const exitInstruction = (node: KiroRepeat): string =>
  `Importer-generated pass-through step: Code Factory needs a step after Kiro repeat "${node.id}" stops, and Kiro has no step here. Do not change files or run commands. Reply with one line: "Repeat ${node.id} stopped."`;

export const stopField = (node: KiroRepeat, path: SourcePath): SourcePath => {
  if (node.stopCondition) return [...path, "stopCondition"];
  if (node.stopWhen !== undefined) return [...path, "stopWhen"];
  return path;
};

export const modelNote = (step: KiroStep, workflow: KiroWorkflow): string => {
  const part = (label: string, own: string | undefined, inherited: string | undefined) => {
    const value = own ?? inherited;
    if (value === undefined) return undefined;
    return `${label} "${value}"${own === undefined ? " (workflow default)" : ""}`;
  };
  const model = part("Kiro model", step.modelId, workflow.modelId);
  const effort = part(model ? "effort" : "Kiro effort", step.effortLevel, workflow.effortLevel);
  const parts = [model, effort].filter((value) => value !== undefined);
  if (!parts.length) return "";
  return `\n\n---\nCode Factory import note: ${parts.join(", ")} (not bound; choose a binding in the editor).`;
};
