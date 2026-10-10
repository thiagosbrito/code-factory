import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
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

/** Fields and buttons keep their own keys; a shortcut never fires from them. */
const keepsOwnKeys =
  'input, textarea, select, button, [contenteditable=""], [contenteditable="true"], .react-flow__controls';

/**
 * Connect and Disconnect for keyboard and screen-reader users. Each goes through the same
 * operations as a mouse gesture (`connectAction`, `disconnectAction`), so refusals carry the same
 * message, a join or decision loses nothing without asking, and every success is one undo entry.
 *
 * A modal dialog hides the rest of the page from assistive technology, so feedback is placed where
 * it can be heard: a refusal is a `notice` shown (and announced) inside the dialog, and a success
 * is announced in the graph's live region once the dialog has closed.
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
  const [asked, setAsked] = useState<LinkRequest | null>(null);
  const [notice, setNotice] = useState("");
  // A request is for a step that exists: if Undo removes the step while the dialog is open, the
  // request ends with it instead of coming back when Redo restores the step.
  if (asked && !loop.steps.some((step) => step.id === asked.stepId)) setAsked(null);
  const request = asked;

  const latest = useRef(loop);
  useLayoutEffect(() => {
    latest.current = loop;
  }, [loop]);
  // The step the dialog was last opened for (the request is cleared before the dialog's close hook
  // runs), what to announce once it has closed, and the disconnect a confirmation is deciding.
  const lastStep = useRef<string | null>(null);
  const afterClose = useRef<string | null>(null);
  const confirming = useRef<StepLink | null>(null);
  const skipFocus = useRef(false);

  const open = useCallback((mode: LinkRequest["mode"], stepId: string) => {
    lastStep.current = stepId;
    setNotice("");
    setAsked({ mode, stepId });
  }, []);
  const close = useCallback(() => setAsked(null), []);

  /** A refused or impossible choice: reason shown and announced inside the dialog, and inline. */
  const refused = useCallback(
    (reason: string) => {
      apply(refuse(reason));
      setNotice(reason);
    },
    [apply],
  );

  const connect = useCallback(
    (from: string, to: string) => {
      const reason = connectionError(loop, from, to);
      if (reason) return refused(reason);
      if (apply(connectAction(from, to))) {
        afterClose.current = `Connected ${nameOf(loop, from)} to ${nameOf(loop, to)}`;
        setAsked(null);
      }
    },
    [apply, loop, refused],
  );

  const disconnect = useCallback(
    (link: StepLink) => {
      if (link.reason) return refused(link.reason);
      const edges = [{ source: link.from, target: link.to }];
      const result = propose(loop, disconnectAction(edges), { kind: "disconnect", edges });
      if (result === "applied") {
        afterClose.current = `Disconnected ${link.fromName} from ${link.toName}`;
        setAsked(null);
      } else if (result === "pending") {
        // The confirmation takes over focus; it also reads out what is about to be lost.
        confirming.current = link;
        skipFocus.current = true;
        setAsked(null);
      }
    },
    [propose, loop, refused],
  );

  /**
   * Called once the link dialog has closed: announces a success now that the live region is
   * audible again and returns the step to give focus back to (none while a confirmation is open).
   */
  const dialogClosed = useCallback((): string | null => {
    if (afterClose.current) {
      announce(afterClose.current);
      afterClose.current = null;
    }
    if (skipFocus.current) {
      skipFocus.current = false;
      return null;
    }
    return lastStep.current;
  }, [announce]);

  /** Called once a confirmation that began in the link dialog has closed; returns where focus goes. */
  const confirmationClosed = useCallback((): string | null => {
    const link = confirming.current;
    if (!link) return null;
    confirming.current = null;
    const stillThere = latest.current.dependencies.some(
      (edge) => edge.from === link.from && edge.to === link.to,
    );
    if (!stillThere) announce(`Disconnected ${link.fromName} from ${link.toName}`);
    return link.from;
  }, [announce]);

  /**
   * Keys on a focused step card: Enter opens its drawer, C and D open Connect and Disconnect, and
   * Alt with an arrow moves focus to the nearest card that way (a plain arrow still moves a
   * selected step; Ctrl and Meta arrows stay the browser's and the screen reader's). Returns true
   * when it handled the key, so the caller skips its own handling. Typing in a field or pressing a
   * button is never a shortcut. C and D are matched by key or physical key, so Caps Lock and
   * non-Latin layouts work.
   */
  const onKeyCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): boolean => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || event.nativeEvent.isComposing) return false;
      if (target.closest(keepsOwnKeys)) return false;
      const card = target.closest<HTMLElement>(".react-flow__node-step");
      const id = card?.getAttribute("data-id");
      if (!card || !id) return false;
      const direction = ARROWS[event.key];
      if (direction && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        const next = neighbourInDirection(displayPositions(loop), id, direction);
        const element = next
          ? event.currentTarget.querySelector<HTMLElement>(
              `.react-flow__node-step[data-id="${CSS.escape(next)}"]`,
            )
          : null;
        // Focusing the card makes the screen reader read its own label; only a miss needs words.
        if (element) element.focus();
        else announce("No step that way");
        return true;
      }
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        openDrawer(id, card);
        return true;
      }
      const letter = event.key.toLowerCase();
      const connectKey = letter === "c" || event.code === "KeyC";
      const disconnectKey = letter === "d" || event.code === "KeyD";
      if (connectKey || disconnectKey) {
        event.preventDefault();
        event.stopPropagation();
        open(connectKey ? "connect" : "disconnect", id);
        return true;
      }
      return false;
    },
    [loop, announce, openDrawer, open],
  );

  return {
    request,
    notice,
    open,
    close,
    connect,
    refused,
    disconnect,
    dialogClosed,
    confirmationClosed,
    onKeyCapture,
  };
};
