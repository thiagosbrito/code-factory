import { useState } from "react";
import { Input } from "@/shared/components/input";
import { NativeSelect } from "@/shared/components/native-select";

const CUSTOM = "\u0000custom";

/**
 * Model choice: the agent's own default, a model it lists, or (when the agent takes any model
 * name) a typed id. Nothing is assumed beyond the agent's default; the list comes from the agent.
 */
export const ModelField = ({
  id,
  value,
  models,
  allowCustom,
  disabled = false,
  ariaLabel,
  onChange,
}: {
  id?: string;
  value: string;
  models: { id: string; displayName: string; description?: string | undefined }[];
  allowCustom: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (model: string) => void;
}) => {
  const listed = value === "agent-default" || models.some((item) => item.id === value);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const custom = allowCustom && (typing || !listed);
  return (
    <div className="grid gap-2">
      <NativeSelect
        id={id}
        aria-label={ariaLabel}
        value={custom ? CUSTOM : value}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          setTyping(next === CUSTOM);
          if (next !== CUSTOM) onChange(next);
        }}
      >
        <option value="agent-default">Agent default</option>
        {models.map((item) => (
          <option key={item.id} value={item.id}>
            {item.displayName}
          </option>
        ))}
        {allowCustom && <option value={CUSTOM}>Custom model…</option>}
        {!allowCustom && !listed && <option value={value}>{value} (unavailable)</option>}
      </NativeSelect>
      {!custom && models.find((item) => item.id === value)?.description && (
        <p className="text-xs font-normal text-muted-foreground">
          {models.find((item) => item.id === value)?.description}
        </p>
      )}
      {custom && (
        <Input
          aria-label={`${ariaLabel} id`}
          placeholder="Model id or alias, e.g. claude-opus-5-5"
          value={listed ? draft : value}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            // A model id is never empty; the binding keeps its last model until one is typed.
            if (event.target.value.trim()) onChange(event.target.value.trim());
          }}
        />
      )}
    </div>
  );
};
