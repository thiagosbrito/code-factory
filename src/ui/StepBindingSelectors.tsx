import type { AgentConnection } from "../adapters/contract.js";
import { providerIdSchema, type ExecutionBinding, type ProviderId } from "../domain/loop.js";
import { NativeSelect } from "@/components/ui/native-select";
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
  const connection = agents.find((item) => item.provider === value?.provider);
  const connected = connection && connectionViewModel(connection).connected;
  const model = connection?.models?.find((item) => item.id === value?.model);
  const effortOptions = model?.efforts ?? [];
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
      {value && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            Model
            <NativeSelect
              aria-label="Step model"
              value={value.model}
              disabled={!connected}
              onChange={(event) =>
                onChange({ provider: value.provider, model: event.target.value })
              }
            >
              <option value="agent-default">Agent default</option>
              {connected &&
                connection.models?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
              {value.model !== "agent-default" &&
                !connection?.models?.some((item) => item.id === value.model) && (
                  <option value={value.model}>{value.model} (unavailable)</option>
                )}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Effort
            <NativeSelect
              aria-label="Step effort"
              value={value.effort ?? ""}
              disabled={!connected || !effortOptions.length}
              onChange={(event) =>
                onChange({
                  ...value,
                  ...(event.target.value ? { effort: event.target.value } : { effort: undefined }),
                })
              }
            >
              <option value="">Agent default</option>
              {effortOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
              {value.effort && !effortOptions.includes(value.effort) && (
                <option value={value.effort}>{value.effort} (unavailable)</option>
              )}
            </NativeSelect>
          </label>
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
