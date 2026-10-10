import { createContext, useContext } from "react";
import type { StepFacts } from "../../../shared/step-facts";

/** Resolves a step's agent, model and effort; the node data stays purely structural. */
export type ResolveStepFacts = (stepId: string) => StepFacts | null;

const StepFactsContext = createContext<ResolveStepFacts | null>(null);

export const StepFactsProvider = StepFactsContext.Provider;
export const useStepFacts = (stepId: string): StepFacts | null =>
  useContext(StepFactsContext)?.(stepId) ?? null;
