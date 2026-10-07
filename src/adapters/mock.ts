import { randomUUID } from "node:crypto";
import type { AgentAdapter, AdapterEvent, StepExecutionInput } from "./contract.js";

/** Deterministic protocol fixture; it does not edit files or call an AI provider. */
export const mockAdapter: AgentAdapter = {
  provider: "mock",
  capabilities: {
    streaming: "supported",
    steering: "unsupported",
    resume: "unsupported",
    pause: "unsupported",
    waitingInput: "unsupported",
  },
  async inspect() {
    return {
      provider: "mock",
      executable: null,
      installation: "built-in",
      authentication: "not-required",
      capabilities: this.capabilities,
      models: [],
    };
  },
  async *execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent> {
    signal.throwIfAborted();
    const session = {
      runId: input.runId,
      stepId: input.stepId,
      attempt: input.attempt,
      sessionId: randomUUID(),
      turnId: randomUUID(),
    };
    yield { type: "started", ...session };
    signal.throwIfAborted();
    yield {
      type: "message",
      text: `Mock step ${input.stepId}, attempt ${input.attempt}`,
      ...session,
    };
    signal.throwIfAborted();
    yield {
      type: "completed",
      outcome: "succeeded",
      output: input.allowedOutcomes?.includes("pass")
        ? "pass"
        : (input.allowedOutcomes?.[0] ?? "Mock output. No project files were changed."),
      ...session,
    };
  },
  attach() {
    return {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw new Error("Mock recovery is unsupported.");
          },
        };
      },
    };
  },
  async steer() {
    return "unsupported" as const;
  },
};
