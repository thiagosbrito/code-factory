import type { ConnectionViewModel } from "../../shared/connection";
import { EffortSlider } from "../../shared/EffortSlider";
import { ModelField } from "../../shared/ModelField";
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
        <ModelField
          id="default-model"
          ariaLabel="Project default model"
          value={model}
          models={active?.models ?? []}
          allowCustom={Boolean(active?.customModels)}
          disabled={!active?.connected}
          onChange={onModelChange}
        />
        <small className="font-normal text-muted-foreground">
          {active?.connected
            ? "Models come from this connection's catalog; listing does not guarantee entitlement."
            : hasSavedBinding
              ? "Saved default is retained until you change it."
              : "Connect an agent to load its catalog."}
        </small>
      </label>
      {availableEfforts.length > 0 && (
        <div className="mt-4 grid max-w-sm gap-2 text-sm font-medium">
          Effort
          <EffortSlider
            id="default-effort"
            ariaLabel="Project default effort"
            efforts={availableEfforts}
            value={effort || undefined}
            onChange={(next) => onEffortChange(next ?? "")}
          />
        </div>
      )}
      {validation && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {validation}
        </p>
      )}
    </SetupSection>
  );
};
