import type { ExecutionBinding, ProviderId } from "../domain/loop.js";

export type CapabilitySupport = "supported" | "unsupported" | "unknown";
export interface AgentCapabilities {
  streaming: CapabilitySupport;
  steering: CapabilitySupport;
  resume: CapabilitySupport;
}
export interface AgentConnection {
  provider: ProviderId;
  executable: string | null;
  installation: "detected" | "missing" | "built-in";
  authentication: "unknown" | "not-required";
  capabilities: AgentCapabilities;
}
export interface StepExecutionInput {
  runId: string;
  stepId: string;
  attempt: number;
  instruction: string;
  binding: ExecutionBinding;
}
export type AdapterEvent =
  | { type: "started"; sessionId: string }
  | { type: "message"; text: string }
  | { type: "completed"; outcome: "succeeded" | "failed"; output: string };

/** The factory owns loop scheduling. An adapter executes one assigned step. */
export interface AgentAdapter {
  readonly provider: ProviderId;
  readonly capabilities: AgentCapabilities;
  execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent>;
}

/** Configuration translation is separate from process execution and may be lossy. */
export interface ConfigurationTranslator {
  readonly provider: ProviderId;
  exportInstructions(
    instruction: string,
  ): { relativePath: string; content: string; warnings: string[] }[];
  importInstructions(files: { relativePath: string; content: string }[]): {
    instruction: string;
    warnings: string[];
  };
}
