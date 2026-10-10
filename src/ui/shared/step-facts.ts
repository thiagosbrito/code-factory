import type { AgentConnection } from "../../adapters/contract.js";
import type { ExecutionBinding } from "../../domain/loop.js";
import { providerName } from "./connection";

/** What a step card says about who runs the step; the same words in the editor and on the run. */
export type StepFacts = {
  agent: string;
  model: string;
  effort: string;
  /** True when the step has no binding of its own and the values come from the project default. */
  inherited: boolean;
};

export const NOT_CONFIGURED = "Not configured";

/**
 * Describes a binding for display: the agent's name, the model's display name (its id when the
 * adapter does not list it) and the effort level. A step without a binding shows the project
 * default and says so; with neither, every fact reads "Not configured" rather than a guess.
 */
export const stepFacts = ({
  binding,
  projectDefault,
  agents,
}: {
  binding: ExecutionBinding | null | undefined;
  projectDefault: ExecutionBinding | null | undefined;
  agents: AgentConnection[];
}): StepFacts => {
  const effective = binding ?? projectDefault ?? null;
  if (!effective)
    return {
      agent: NOT_CONFIGURED,
      model: NOT_CONFIGURED,
      effort: NOT_CONFIGURED,
      inherited: true,
    };
  const listed = agents
    .find((item) => item.provider === effective.provider)
    ?.models?.find((item) => item.id === effective.model);
  return {
    agent: providerName(effective.provider),
    model:
      effective.model === "agent-default"
        ? "Agent default"
        : (listed?.displayName ?? effective.model),
    effort: effective.effort ?? "Default",
    inherited: !binding,
  };
};
