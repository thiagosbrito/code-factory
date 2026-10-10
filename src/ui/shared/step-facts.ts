import type { AgentConnection } from "../../adapters/contract.js";
import type { ExecutionBinding } from "../../domain/loop.js";
import { effortChoices } from "../../domain/binding-catalog.js";
import { providerName } from "./connection";

/** What a step card says about who runs the step; the same words in the editor and on the run. */
export type StepFacts = {
  agent: string;
  model: string;
  effort: string;
  /** Where the effort sits among the agent's levels (0 is the agent default); null when unknown. */
  effortScale: { position: number; total: number } | null;
  /** True when the step has no binding of its own and the values come from the project default. */
  inherited: boolean;
};

export const NOT_CONFIGURED = "Not configured";

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Describes a binding for display: the agent's name, the model's display name (its id when the
 * adapter does not list it) and the effort level. A step without a binding shows the project
 * default and says so; with neither, every fact reads "Not configured" rather than a guess.
 * Check steps run a shell command, never an agent, so callers show no facts for them.
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
      effortScale: null,
      inherited: true,
    };
  const connection = agents.find((item) => item.provider === effective.provider);
  const listed = connection?.models?.find((item) => item.id === effective.model);
  const levels = effortChoices(connection, effective.model);
  // A saved level the agent no longer lists (-1) has no honest place on the scale.
  const position = effective.effort ? levels.indexOf(effective.effort) + 1 : 0;
  const listedEffort = !effective.effort || position > 0;
  return {
    agent: providerName(effective.provider),
    model:
      effective.model === "agent-default"
        ? "Agent default"
        : (listed?.displayName ?? effective.model),
    effort: effective.effort ? capitalized(effective.effort) : "Default",
    effortScale: levels.length && listedEffort ? { position, total: levels.length } : null,
    inherited: !binding,
  };
};
