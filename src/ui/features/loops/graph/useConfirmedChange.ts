import { useCallback, useState } from "react";
import type { LoopDefinition } from "../../../../domain/loop.js";
import type { Apply, LoopAction } from "./graph-actions";
import { changeWarnings, type ProposedChange } from "./graph-warnings";

type Pending = { loop: LoopDefinition; action: LoopAction; warnings: string[] };
export type Proposal = "applied" | "refused" | "pending";

/**
 * Applies a change straight away unless it has warnings; then it waits for an explicit
 * confirmation. A confirmed change is ONE `apply`, so one undo entry. A pending change belongs to
 * the loop it was proposed on: if the loop changes meanwhile (for example Undo) it is dropped
 * instead of being applied to something else.
 */
export const useConfirmedChange = (loop: LoopDefinition, apply: Apply, restore: () => void) => {
  const [pending, setPending] = useState<Pending | null>(null);
  const active = pending && pending.loop === loop ? pending : null;

  const propose = useCallback(
    (current: LoopDefinition, action: LoopAction, change: ProposedChange): Proposal => {
      const warnings = changeWarnings(current, change);
      if (!warnings.length) return apply(action) ? "applied" : "refused";
      setPending({ loop: current, action, warnings });
      return "pending";
    },
    [apply],
  );

  const confirm = () => {
    setPending(null);
    if (active) apply(active.action);
  };

  // Cancel changes nothing in the loop; the flow is redrawn so a dragged step snaps back.
  const cancel = () => {
    setPending(null);
    restore();
  };

  return { warnings: active?.warnings ?? null, propose, confirm, cancel };
};
