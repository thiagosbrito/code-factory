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
  authentication: "unknown" | "not-required" | "authenticated" | "unauthenticated";
  authenticationMechanism?: string;
  capabilities: AgentCapabilities;
  version?: string;
  protocol?: string;
  models?: { id: string; displayName: string }[];
}
export interface StepExecutionInput {
  runId: string;
  stepId: string;
  attempt: number;
  instruction: string;
  binding: ExecutionBinding;
  projectDirectory: string;
}
export interface StepSession {
  runId: string;
  stepId: string;
  attempt: number;
  sessionId: string;
  turnId: string;
}
export type AdapterEvent =
  | ({ type: "started" } & StepSession)
  | ({ type: "message"; text: string } & StepSession)
  | ({ type: "completed"; outcome: "succeeded" | "failed"; output: string } & StepSession);

/** The factory owns loop scheduling. An adapter executes one assigned step. */
export interface AgentAdapter {
  readonly provider: ProviderId;
  readonly capabilities: AgentCapabilities;
  inspect(projectDirectory: string): Promise<AgentConnection>;
  execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent>;
  attach(session: StepSession, signal: AbortSignal): AsyncIterable<AdapterEvent>;
  steer(session: StepSession, guidance: string): Promise<CapabilitySupport>;
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
