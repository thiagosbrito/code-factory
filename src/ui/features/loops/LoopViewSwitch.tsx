import type { Ref } from "react";
import { loopEditorViews, type LoopEditorView } from "./loop-editor-view";

/** Board | Graph segmented control; native buttons keep Tab, Enter and Space working. */
export const LoopViewSwitch = ({
  view,
  onChange,
  switchRef,
}: {
  view: LoopEditorView;
  switchRef?: Ref<HTMLFieldSetElement>;
  onChange: (view: LoopEditorView) => void;
}) => (
  <fieldset
    ref={switchRef}
    aria-label="Editor view"
    className="m-0 inline-flex min-w-0 rounded-lg border bg-card p-0.5 text-sm"
  >
    {loopEditorViews.map(({ id, label }) => (
      <button
        key={id}
        data-view={id}
        type="button"
        aria-pressed={view === id}
        onClick={() => onChange(id)}
        className={`rounded-md px-3 py-1 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          view === id
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
      </button>
    ))}
  </fieldset>
);
