import type { LoopDefinition } from "../../../domain/loop.js";

/** Placeholder for the advanced graph view; the interactive graph replaces it later. */
const LoopGraphView = ({ loop }: { loop: LoopDefinition }) => (
  <section aria-label="Graph view" className="flex min-w-0 items-center justify-center p-6">
    <div className="max-w-md rounded-lg border bg-card p-6 text-center">
      <h2 className="text-base font-semibold">Advanced graph view</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        The interactive graph is coming soon. It will edit the same draft as the Board. This loop
        has {loop.steps.length} {loop.steps.length === 1 ? "step" : "steps"}; switch back to the
        Board to keep editing.
      </p>
    </div>
  </section>
);

export default LoopGraphView;
