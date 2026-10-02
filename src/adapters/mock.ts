import { randomUUID } from "node:crypto";
import type { AgentAdapter, AdapterEvent, StepExecutionInput } from "./contract.js";

/** Deterministic protocol fixture; it does not edit files or call an AI provider. */
export const mockAdapter: AgentAdapter = {
  provider: "mock",
  capabilities: { streaming: "supported", steering: "unsupported", resume: "unsupported" },
  async *execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent> {
    signal.throwIfAborted();
    yield { type: "started", sessionId: randomUUID() };
    signal.throwIfAborted();
    yield { type: "message", text: `Mock step ${input.stepId}, attempt ${input.attempt}` };
    signal.throwIfAborted();
    yield {
      type: "completed",
      outcome: "succeeded",
      output: "Mock output. No project files were changed.",
    };
  },
};
