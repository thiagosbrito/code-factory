import type { ConnectionViewModel } from "./connection";
import { NativeSelect } from "@/components/ui/native-select";
import { SetupSection } from "./SetupSection";

export const ModelSetupSection = ({
  active,
  model,
  effort,
  availableEfforts,
  hasSavedBinding,
  validation,
  onModelChange,
  onEffortChange,
}: {
  active: ConnectionViewModel | undefined;
  model: string;
  effort: string;
  availableEfforts: string[];
  hasSavedBinding: boolean;
  validation: string | null;
  onModelChange: (value: string) => void;
  onEffortChange: (value: string) => void;
}) => {
  return (
    <SetupSection
      number={3}
      title="Default model"
      description="Used for future runs; existing run snapshots retain their bindings"
    >
      <label htmlFor="default-model" className="grid max-w-sm gap-2 text-sm font-medium">
        Project default model
        <NativeSelect
          id="default-model"
          aria-label="Project default model"
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          disabled={!active?.connected}
          className="font-normal text-muted-foreground"
        >
          <option value="agent-default">Agent default</option>
          {active?.models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.displayName}
            </option>
          ))}
          {model !== "agent-default" && !active?.models.some((item) => item.id === model) && (
            <option value={model}>{model} (unavailable)</option>
          )}
        </NativeSelect>
        <small className="font-normal text-muted-foreground">
          {active?.connected
            ? "Models come from this connection's catalog; listing does not guarantee entitlement."
            : hasSavedBinding
              ? "Saved default is retained until you change it."
              : "Connect an agent to load its catalog."}
        </small>
      </label>
      {availableEfforts.length > 0 && (
        <label htmlFor="default-effort" className="mt-4 grid max-w-sm gap-2 text-sm font-medium">
          Effort
          <NativeSelect
            id="default-effort"
            value={effort}
            onChange={(event) => onEffortChange(event.target.value)}
          >
            <option value="">Agent default</option>
            {availableEfforts.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {validation && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {validation}
        </p>
      )}
    </SetupSection>
  );
};
