import type { ExecutionBinding, ProviderId } from "../domain/loop.js";

export type CapabilitySupport = "supported" | "unsupported" | "unknown";
export interface AgentCapabilities {
  streaming: CapabilitySupport;
  steering: CapabilitySupport;
  resume: CapabilitySupport;
  pause: CapabilitySupport;
  waitingInput: CapabilitySupport;
}
export interface AgentConnection {
  provider: ProviderId;
  executable: string | null;
  installation: "detected" | "missing" | "built-in";
  authentication: "unknown" | "not-required" | "authenticated" | "unauthenticated";
  authenticationMechanism?: string | undefined;
  capabilities: AgentCapabilities;
  version?: string | undefined;
  protocol?: string | undefined;
  identity?: string | undefined;
  reason?: string | undefined;
  models?: { id: string; displayName: string; efforts?: string[] | undefined }[] | undefined;
}
export interface StepExecutionInput {
  runId: string;
  stepId: string;
  attempt: number;
  instruction: string;
  allowedOutcomes?: string[];
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
  | ({ type: "tool"; title: string; detail?: string; state?: string } & StepSession)
  | ({ type: "check"; title: string; detail?: string; state?: string } & StepSession)
  | ({ type: "error"; text: string } & StepSession)
  | ({
      type: "input-request";
      requestId: string | number;
      itemId: string;
      questions: InputQuestion[];
      isBlocking: boolean;
      autoResolutionMs: number | null;
    } & StepSession)
  | ({ type: "completed"; outcome: "succeeded" | "failed"; output: string } & StepSession);

export interface InputQuestion {
  id: string;
  header: string;
  question: string;
  options: { label: string; description: string }[];
}

export class CancellationUnconfirmedError extends Error {
  override readonly name = "CancellationUnconfirmedError";
}

/** The factory owns loop scheduling. An adapter executes one assigned step. */
export interface AgentAdapter {
  readonly provider: ProviderId;
  readonly capabilities: AgentCapabilities;
  inspect(projectDirectory: string): Promise<AgentConnection>;
  execute(input: StepExecutionInput, signal: AbortSignal): AsyncIterable<AdapterEvent>;
  attach(session: StepSession, signal: AbortSignal): AsyncIterable<AdapterEvent>;
  steer(session: StepSession, guidance: string): Promise<CapabilitySupport>;
  replyToInput?(
    session: StepSession,
    requestId: string | number,
    answers: Record<string, { answers: string[] }>,
  ): Promise<void>;
}
