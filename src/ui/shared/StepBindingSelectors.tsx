import type { AgentConnection } from "../../adapters/contract.js";
import { providerIdSchema, type ExecutionBinding, type ProviderId } from "../../domain/loop.js";
import { NativeSelect } from "@/shared/components/native-select";
import { effortChoices } from "../../domain/binding-catalog.js";
import { EffortSlider } from "./EffortSlider";
import { ModelField } from "./ModelField";
import { bindingError, connectionViewModel } from "./connection";

/** A null draft inherits the project default. THI-17 can place this in the step drawer. */
export const switchStepProvider = (provider: ProviderId | null): ExecutionBinding | null => {
  return provider ? { provider, model: "agent-default" } : null;
};

export const StepBindingSelectors = ({
  value,
  onChange,
  agents,
  projectDefault,
}: {
  value: ExecutionBinding | null;
  onChange: (binding: ExecutionBinding | null) => void;
  agents: AgentConnection[];
  projectDefault: ExecutionBinding | null;
}) => {
  // A step that inherits the project agent still gets its own model and effort: choosing either
  // makes the step's binding from the inherited one.
  const effective = value ?? projectDefault;
  const connection = agents.find((item) => item.provider === effective?.provider);
  const connected = Boolean(connection && connectionViewModel(connection).connected);
  const efforts = effortChoices(connection, effective?.model ?? "agent-default");
  const error = bindingError(value, agents);
  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm font-medium">
        Coding agent
        <NativeSelect
          aria-label="Step coding agent"
          value={value?.provider ?? ""}
          onChange={(event) =>
            onChange(
              switchStepProvider(
                event.target.value ? providerIdSchema.parse(event.target.value) : null,
              ),
            )
          }
        >
          <option value="">
            Inherit project default
            {projectDefault ? ` · ${projectDefault.provider}` : " · not configured"}
          </option>
          {agents
            .filter((item) => item.provider !== "mock")
            .map((item) => (
              <option key={item.provider} value={item.provider}>
                {connectionViewModel(item).label}
              </option>
            ))}
        </NativeSelect>
      </label>
      {effective && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1 text-sm font-medium">
            Model
            <ModelField
              ariaLabel="Step model"
              value={effective.model}
              models={connected ? (connection?.models ?? []) : []}
              allowCustom={Boolean(connection?.customModels)}
              disabled={!connected}
              onChange={(model) => {
                // Keep the effort when the new model still offers it.
                const kept =
                  effective.effort && effortChoices(connection, model).includes(effective.effort)
                    ? { effort: effective.effort }
                    : {};
                onChange({ provider: effective.provider, model, ...kept });
              }}
            />
          </div>
          <div className="grid gap-1 text-sm font-medium">
            Effort
            <EffortSlider
              ariaLabel="Step effort"
              efforts={connected ? efforts : []}
              value={effective.effort}
              disabled={!connected || efforts.length === 0}
              onChange={(effort) =>
                onChange({
                  provider: effective.provider,
                  model: effective.model,
                  ...(effort ? { effort } : {}),
                })
              }
            />
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
};
