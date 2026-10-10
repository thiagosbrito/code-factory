import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import type { LoopDefinition } from "../../../../domain/loop.js";
import {
  connectAction,
  connectionError,
  disconnectAction,
  refuse,
  type Apply,
} from "./graph-actions";
import { displayPositions } from "./graph-layout";
import { neighbourInDirection, type StepLink } from "./graph-linking";
import type { LinkRequest } from "./LinkDialog";
import type { Proposal } from "./useConfirmedChange";
import type { ProposedChange } from "./graph-warnings";

const nameOf = (loop: LoopDefinition, id: string): string =>
  loop.steps.find((step) => step.id === id)?.name ?? id;

const ARROWS: Record<string, { x: number; y: number } | undefined> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

/**
 * Connect and Disconnect for keyboard and screen-reader users. Each goes through the same
 * operations as a mouse gesture (`connectAction`, `disconnectAction`), so refusals carry the same
 * message, a join or decision loses nothing without asking, and every success is one undo entry.
 * Results are announced in the graph's polite live region.
 */
export const useGraphLinking = ({
  loop,
  apply,
  propose,
  announce,
  openDrawer,
}: {
  loop: LoopDefinition;
  apply: Apply;
  openDrawer: (id: string, origin?: HTMLElement) => void;
  propose: (
    current: LoopDefinition,
    action: (current: LoopDefinition) => LoopDefinition,
    change: ProposedChange,
  ) => Proposal;
  announce: (text: string) => void;
}) => {
  const [request, setRequest] = useState<LinkRequest | null>(null);

  // The step the dialog was last opened for: the request is cleared before the dialog's close
  // hook runs, and focus must go back to that step.
  const lastStep = useRef<string | null>(null);
  const open = useCallback((mode: LinkRequest["mode"], stepId: string) => {
    lastStep.current = stepId;
    setRequest({ mode, stepId });
  }, []);
  const openedFor = useCallback(() => lastStep.current, []);
  const close = useCallback(() => setRequest(null), []);

  /** A refused target: the reason is both shown inline (like a refused drag) and announced. */
  const refused = useCallback(
    (reason: string) => {
      apply(refuse(reason));
      announce(reason);
    },
    [apply, announce],
  );

  const connect = useCallback(
    (from: string, to: string) => {
      const reason = connectionError(loop, from, to);
      if (reason) return refused(reason);
      if (apply(connectAction(from, to))) {
        announce(`Connected ${nameOf(loop, from)} to ${nameOf(loop, to)}`);
        setRequest(null);
      }
    },
    [apply, announce, loop, refused],
  );

  const disconnect = useCallback(
    (link: StepLink) => {
      const edges = [{ source: link.from, target: link.to }];
      const result = propose(loop, disconnectAction(edges), { kind: "disconnect", edges });
      if (result === "applied") announce(`Disconnected ${link.fromName} from ${link.toName}`);
      // "pending" hands over to the confirmation dialog; either way this dialog is done.
      if (result !== "refused") setRequest(null);
    },
    [propose, announce, loop],
  );

  /**
   * Keys on a focused step card: Enter opens its drawer, C and D open Connect and Disconnect, and
   * Alt, Ctrl or Meta with an arrow moves focus to the nearest card that way (a plain arrow still
   * moves a selected step). Returns true when it handled the key, so the caller skips its own
   * handling. Typing in a field or pressing a button is never a shortcut.
   */
  const onKeyCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): boolean => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return false;
      if (target.closest("input, textarea, select, button, .react-flow__controls")) return false;
      const card = target.closest<HTMLElement>(".react-flow__node-step");
      const id = card?.getAttribute("data-id");
      if (!card || !id) return false;
      const modified = event.metaKey || event.ctrlKey || event.altKey;
      const direction = ARROWS[event.key];
      if (direction && modified && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        const next = neighbourInDirection(displayPositions(loop), id, direction);
        const element = next
          ? event.currentTarget.querySelector<HTMLElement>(
              `.react-flow__node-step[data-id="${CSS.escape(next)}"]`,
            )
          : null;
        if (element) {
          element.focus();
          announce(`${nameOf(loop, next ?? id)}`);
        } else announce("No step that way");
        return true;
      }
      if (modified || event.shiftKey) return false;
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        openDrawer(id, card);
        return true;
      }
      if (event.key === "c" || event.key === "d") {
        event.preventDefault();
        event.stopPropagation();
        open(event.key === "c" ? "connect" : "disconnect", id);
        return true;
      }
      return false;
    },
    [loop, announce, openDrawer, open],
  );

  return { request, open, openedFor, close, connect, refused, disconnect, onKeyCapture };
};
