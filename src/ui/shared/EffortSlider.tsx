const label = (level: string): string => level.charAt(0).toUpperCase() + level.slice(1);

/**
 * Effort as a slider from the agent's default through its levels, lightest to heaviest, in the
 * order the agent lists them. The first stop leaves effort unset. A saved level the agent no
 * longer lists stays as a last stop, marked unavailable, so nothing is dropped silently.
 */
export const EffortSlider = ({
  id,
  efforts,
  value,
  onChange,
  disabled = false,
  ariaLabel = "Effort",
}: {
  id?: string;
  efforts: string[];
  value: string | undefined;
  onChange: (effort: string | undefined) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) => {
  const stale = value && !efforts.includes(value) ? [value] : [];
  const stops = [undefined, ...efforts, ...stale];
  const index = Math.max(0, stops.indexOf(value));
  const text = (stop: string | undefined) =>
    stop === undefined
      ? "Agent default"
      : stale.includes(stop)
        ? `${label(stop)} (unavailable)`
        : label(stop);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{text(stops[index])}</span>
        {disabled && <span className="text-xs text-muted-foreground">Not offered</span>}
      </div>
      <input
        id={id}
        type="range"
        aria-label={ariaLabel}
        aria-valuetext={text(stops[index])}
        min={0}
        max={stops.length - 1}
        step={1}
        value={index}
        disabled={disabled || efforts.length === 0}
        onChange={(event) => onChange(stops[Number(event.target.value)])}
        className="h-2 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div aria-hidden="true" className="flex justify-between text-[10px] text-muted-foreground">
        {stops.map((stop) => (
          <span key={stop ?? "default"}>{stop === undefined ? "Default" : label(stop)}</span>
        ))}
      </div>
    </div>
  );
};
