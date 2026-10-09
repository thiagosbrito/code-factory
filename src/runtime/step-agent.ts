import { CancellationUnconfirmedError, type StepExecutionInput } from "../adapters/contract.js";
import { attachAttemptSession } from "../domain/run.js";
import type { StepResult } from "../domain/scheduler.js";
import { describeToolGrant, TOOL_PERMISSION } from "../domain/tool-grant.js";
import { deliverQueuedGuidance } from "./guidance.js";
import { resolveToolGrant } from "./tool-grant.js";
import {
  AGENT_NOT_CONNECTED,
  agentNotConnected,
  agentOutcome,
  changedFilesContext,
  reviewResult,
} from "./scheduler-inputs.js";
import { appendEvent, appendLocalEvent, recordInputRequest } from "./scheduler-evidence.js";
import type { RunContext, StepFrame } from "./run-context.js";

/** Drive (or recover) an agent step through its adapter stream and return its reported result. */
export const runAgentStep = async (ctx: RunContext, frame: StepFrame): Promise<StepResult> => {
  const { commit, signal, project, runId } = ctx;
  const { stepId, definition, attempt, recovering, copyFailure, executionDirectory } = frame;
  const readonly = frame.readonly;
  const priorCompletion = recovering
    ? ctx
        .record()
        .evidence.find(
          (item) =>
            item.kind === "event" && item.attemptId === attempt.id && item.title === "completed",
        )
    : undefined;
  const binding = ctx.record().snapshot.bindings[stepId];
  const adapter = binding ? ctx.resolveAdapter(binding.provider) : null;
  if (priorCompletion?.kind === "event")
    return {
      status: priorCompletion.state === "succeeded" ? "succeeded" : "failed",
      ...(priorCompletion.detail
        ? definition.stage === "review"
          ? reviewResult(priorCompletion.detail)
          : { outcome: agentOutcome(ctx.record(), stepId, priorCompletion.detail) }
        : {}),
      ...(priorCompletion.detail ? { summary: priorCompletion.detail } : {}),
    };
  if (copyFailure) return { status: "failed", summary: copyFailure };
  if (!adapter || !binding) {
    if (recovering) throw new Error("The selected adapter is not connected for recovery.");
    // A failed (retryable) step with its reason, never a silent, final "unavailable" run.
    const detail = agentNotConnected(binding?.provider ?? "The selected agent");
    await commit((current) =>
      appendLocalEvent(current, stepId, attempt.id, "check", AGENT_NOT_CONNECTED, detail, "failed"),
    );
    return { status: "failed", summary: detail };
  }
  let result: StepResult = { status: "failed" };
  const allowedOutcomes =
    ctx
      .record()
      .snapshot.loop.decisions.find((item) => item.stepId === stepId)
      ?.branches.map((branch) => branch.outcome) ??
    (definition.stage === "review" ? ["pass", "changes-requested", "blocked"] : undefined);
  const input: StepExecutionInput = {
    runId,
    stepId,
    attempt: attempt.number,
    instruction: [
      definition.instruction,
      frame.inputs.context,
      frame.runChanges && frame.base && changedFilesContext(frame.base, frame.runChanges),
      allowedOutcomes &&
        (definition.stage === "review"
          ? `Put exactly one verdict on the first line: ${allowedOutcomes.join(", ")}. Add concrete findings on subsequent lines when requesting changes.`
          : `Return exactly one outcome: ${allowedOutcomes.join(", ")}.`),
    ]
      .filter(Boolean)
      .join("\n\n"),
    ...(allowedOutcomes ? { allowedOutcomes } : {}),
    binding,
    projectDirectory: executionDirectory,
    ...(readonly ? { readOnly: true } : {}),
  };
  if (readonly && !recovering && binding.provider !== "mock")
    await commit((current) =>
      appendLocalEvent(
        current,
        stepId,
        attempt.id,
        "lifecycle",
        TOOL_PERMISSION,
        `Read-only reviewer: ${binding.provider} runs without write or shell permissions it can enforce, and the project's tool grant does not apply.`,
      ),
    );
  // A grant is read per fresh attempt, so grant and revoke apply at the next attempt.
  if (!readonly && !recovering && binding.provider !== "mock") {
    const permission = await resolveToolGrant(project, binding.provider);
    if (permission.grant) input.toolGrant = permission.grant;
    await commit((current) =>
      appendLocalEvent(
        current,
        stepId,
        attempt.id,
        "lifecycle",
        TOOL_PERMISSION,
        describeToolGrant(binding.provider, permission.grant, executionDirectory, permission.note),
      ),
    );
  }
  let cancellationUnconfirmed = false;
  try {
    let completed = false;
    if (
      recovering &&
      (adapter.capabilities.resume !== "supported" ||
        !attempt.sessionId ||
        !attempt.turnId ||
        readonly)
    )
      throw new Error("Active recovery is unsupported or lacks a verified session handle.");
    const stream = recovering
      ? adapter.attach(
          {
            runId,
            stepId,
            attempt: attempt.number,
            sessionId: attempt.sessionId ?? "",
            turnId: attempt.turnId ?? "",
          },
          signal,
        )
      : adapter.execute(input, signal);
    for await (const event of stream) {
      if (
        event.runId !== runId ||
        event.stepId !== stepId ||
        event.attempt !== attempt.number ||
        (recovering && (event.sessionId !== attempt.sessionId || event.turnId !== attempt.turnId))
      )
        throw new Error("Adapter event identity mismatch.");
      if (event.type === "started" && !recovering)
        await commit((current) =>
          attachAttemptSession(current, stepId, event.sessionId, event.turnId),
        );
      if (event.type === "completed") completed = true;
      if (event.type === "completed")
        result = {
          status: event.outcome,
          ...(definition.stage === "review"
            ? reviewResult(event.output)
            : { outcome: agentOutcome(ctx.record(), stepId, event.output) }),
          summary: event.output,
        };
      if (event.type === "input-request")
        await commit((current) => recordInputRequest(current, stepId, attempt.id, event));
      else await commit((current) => appendEvent(current, stepId, attempt.id, event));
      // Deliberately outside the commit chain, as before the split: it writes the record directly.
      if (event.type === "started")
        ctx.setRecord(
          await deliverQueuedGuidance(project, ctx.record(), stepId, attempt.id, adapter),
        );
    }
    if (!completed) throw new Error("Adapter stream ended without a verified completion.");
  } catch (error) {
    if (error instanceof CancellationUnconfirmedError) {
      cancellationUnconfirmed = true;
      result = { status: "unavailable", summary: error.message };
    } else {
      if (!signal.aborted) throw error;
      result = { status: "canceled" };
    }
  }
  if (signal.aborted && !cancellationUnconfirmed) result = { status: "canceled" };
  return result;
};
