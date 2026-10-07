import type { ConfigurationTranslator } from "./contract.js";
import { cursorRuleTranslator } from "./cursor-rule.js";
import { kiroWorkflowTranslator } from "./kiro-workflow.js";
const translators: readonly ConfigurationTranslator[] = [
  cursorRuleTranslator,
  kiroWorkflowTranslator,
];
export const listTranslators = (): readonly ConfigurationTranslator[] => translators;
export const getTranslator = (format: string): ConfigurationTranslator => {
  const translator = translators.find((candidate) => candidate.format === format);
  if (!translator) throw new Error(`Unsupported native configuration format: ${format}`);
  return translator;
};
