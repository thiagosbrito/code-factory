import type { AgentConnection } from "../../../../adapters/contract.js";
import { RETRY_NOT_ELIGIBLE, retryBlocker, type RunRecord } from "../../../../domain/run.js";
import type { RunScope, RunStep, StepDefinition } from "../run-view-model";

/** Why the selected step cannot be retried right now, or an empty string when it can. */
export const retryReason = ({
  run,
  scope,
  step,
  definition,
  agents,
  connected,
  executing,
}: {
  run: RunRecord;
  scope: RunScope;
  step: RunStep | undefined;
  definition: StepDefinition | undefined;
  agents: AgentConnection[];
  connected: boolean;
  executing: boolean;
}): string => {
  const latestAttempt = step?.attempts.at(-1);
  const connection =
    definition &&
    agents.find((agent) => agent.provider === run.snapshot.bindings[definition.id]?.provider);
  const connectionReady =
    definition?.kind === "check" ||
    run.snapshot.bindings[definition?.id ?? ""]?.provider === "mock" ||
    connection?.authentication === "authenticated";
  const domainBlocker = step ? retryBlocker(run, step.stepId) : "Unknown retry target.";
  return !connected
    ? "Reconnect the runtime first."
    : executing
      ? "Work is already active."
      : domainBlocker === RETRY_NOT_ELIGIBLE || !step
        ? "Only failed or blocked review work can be retried."
        : scope.kind === "step" && scope.attemptId !== latestAttempt?.id
          ? "Select the latest attempt to retry."
          : !connectionReady
            ? "Verify this step’s connection before retrying."
            : step &&
                step.attempts.filter((item) => item.implementationRound === run.implementationRound)
                  .length >= run.snapshot.loop.policy.maxAttemptsPerStep
              ? "Attempt limit reached for this step."
              : "";
};
