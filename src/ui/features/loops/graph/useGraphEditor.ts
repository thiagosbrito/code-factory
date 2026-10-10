import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  useEdgesState,
  useNodesState,
  type IsValidConnection,
  type OnConnect,
  type OnBeforeDelete,
  type OnNodeDrag,
  type NodeMouseHandler,
} from "@xyflow/react";
import type { LoopDefinition } from "../../../../domain/loop.js";
import {
  connectAction,
  connectEndRefusal,
  connectionError,
  disconnectAction,
  dropAction,
  planDrops,
  planKeyboardMove,
  refuse,
  type Apply,
  type ConnectEnd,
} from "./graph-actions";
import { displayPositions, type Point } from "./graph-layout";
import {
  buildGraph,
  type DependencyFlowEdge,
  type GraphNode,
  type StepFlowNode,
} from "./graph-mapping";

const isStepNode = (node: GraphNode): node is StepFlowNode => node.type === "step";

/** Carries the current selection over to a freshly derived element list, matching by id. */
const keepSelection = <T extends { id: string; selected?: boolean }>(
  next: T[],
  previous: T[],
): T[] => {
  const selected = new Set(previous.filter((item) => item.selected).map((item) => item.id));
  return selected.size
    ? next.map((item) => (selected.has(item.id) ? { ...item, selected: true } : item))
    : next;
};

/** Typing in a field, or pressing a button such as the zoom controls, is never a graph shortcut. */
const isTextTarget = (target: EventTarget): boolean =>
  target instanceof HTMLElement &&
  (target.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]') ||
    target.closest("button, .react-flow__controls") !== null);

/** One arrow press moves a selected step this many px (Shift multiplies by 4). */
const ARROW_STEP = 10;
const ARROW_WORD: Record<string, string | undefined> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};
const ARROW_DIRECTION: Record<string, Point | undefined> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

/**
 * Flow state and handlers for the Graph view. The loop stays authoritative: every gesture becomes
 * one `apply` call, the flow is reseeded only when the derived graph changes, and a refused or
 * no-op gesture snaps the flow back to what the loop says.
 */
export const useGraphEditor = ({
  loop,
  apply,
  openDrawer,
}: {
  loop: LoopDefinition;
  apply: Apply;
  openDrawer: (id: string, origin?: HTMLElement) => void;
}) => {
  // Derived once per loop value; the flow is reseeded only when the loop itself changes.
  const seed = useMemo(() => buildGraph(loop), [loop]);
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNode>(seed.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<DependencyFlowEdge>(seed.edges);
  // Handlers read the newest loop and graph through a ref, so they stay stable between renders.
  const latest = useRef({ loop, seed, edges, nodes });
  useLayoutEffect(() => {
    latest.current = { loop, seed, edges, nodes };
  }, [loop, seed, edges, nodes]);
  // A reseed during a drag (for example Undo pressed mid-drag) would yank the node from under the
  // pointer; the drop handler reconciles with the newest loop once the drag ends.
  const dragging = useRef(false);
  // Keyboard moves fold into one undo entry per session; a blur or a pointer drag starts a new one.
  const session = useRef(0);
  const stalled = useRef<{ loop: LoopDefinition; spec: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const reseed = useCallback(() => {
    const { seed: next } = latest.current;
    setNodes((previous) => keepSelection(next.nodes, previous));
    setEdges((previous) => keepSelection(next.edges, previous));
  }, [setNodes, setEdges]);

  useEffect(() => {
    if (!dragging.current) reseed();
  }, [seed, reseed]);

  const restore = reseed;

  const isValidConnection = useCallback<IsValidConnection>(
    (connection) =>
      connectionError(latest.current.loop, connection.source, connection.target) === null,
    [],
  );

  const onConnect = useCallback<OnConnect>(
    (connection) => {
      apply(connectAction(connection.source, connection.target));
    },
    [apply],
  );

  // A released connection the dry run refused never reaches onConnect, so the reason is reported
  // here. This only explains: the refusal is shown inline through a throwing action, which records
  // no history and never adds a dependency, even when the library resolved a handle of the wrong kind.
  const reportConnectEnd = useCallback(
    (end: ConnectEnd) => {
      const message = connectEndRefusal(latest.current.loop, end);
      if (message) apply(refuse(message));
    },
    [apply],
  );

  // Delete and Backspace are handled on the flow wrapper, not on the document, so they act only
  // while focus is inside the graph and never while typing or on a button (zoom controls, the
  // edge delete control, which removes its edge on click).
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if ((event.key !== "Delete" && event.key !== "Backspace") || isTextTarget(event.target))
        return;
      const doomed = latest.current.edges.filter((edge) => edge.selected);
      if (!doomed.length) return;
      event.preventDefault();
      // The focused edge unmounts with its deletion; keep focus in the graph rather than losing it.
      if (apply(disconnectAction(doomed))) event.currentTarget.focus();
    },
    [apply],
  );

  // The library moves selected steps on arrow keys inside its own flow state, where onNodeDragStop
  // never fires: the step would be drawn where the loop does not record it and snap back on the
  // next reseed. The capture phase sees the key first, so a move of a SELECTED step is routed
  // through the planner and `apply` instead and the library's handler never runs. Enter, Space and
  // Escape (selection) and arrows on a step that is not selected are left alone; modified arrows
  // keep their default but do not reach the library. Moves are based on the loop, not the flow
  // state, and are ignored while a pointer drag is in progress.
  const onKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const direction = ARROW_DIRECTION[event.key];
      if (!direction) return;
      if (isTextTarget(event.target) || !(event.target instanceof Element)) return;
      const step = event.target.closest(".react-flow__node-step");
      const rectangle = event.target.closest(".react-flow__nodesselection-rect");
      const { loop: current, nodes: flow } = latest.current;
      const selected = flow.filter(
        (node): node is StepFlowNode => isStepNode(node) && node.selected === true,
      );
      if (!step && !rectangle) return;
      if (!rectangle && !selected.some((node) => node.id === step?.getAttribute("data-id"))) return;
      event.stopPropagation();
      // Modified arrows stay the browser's (and, later, keyboard linking's): their default is not
      // cancelled, but the library's flow-only move must not run for them either.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      if (dragging.current || !selected.length) return;
      const spec = `${event.key}${event.shiftKey ? "+Shift" : ""}`;
      // A held key repeats a press that changed nothing: skip the planning until the loop changes.
      if (event.repeat && stalled.current?.loop === current && stalled.current.spec === spec)
        return;
      const drawn = displayPositions(current);
      const distance = ARROW_STEP * (event.shiftKey ? 4 : 1);
      const moves = selected.flatMap(({ id }) => {
        const base = drawn.get(id);
        return base
          ? [
              {
                id,
                position: {
                  x: base.x + direction.x * distance,
                  y: base.y + direction.y * distance,
                },
              },
            ]
          : [];
      });
      const label =
        selected.length === 1
          ? (current.steps.find((item) => item.id === selected[0]?.id)?.name ?? "Step")
          : `${selected.length} steps`;
      const word = ARROW_WORD[event.key] ?? "";
      const plan = planKeyboardMove(current, moves, direction);
      stalled.current = plan.kind === "moved" ? null : { loop: current, spec };
      if (plan.kind === "edge") setAnnouncement(`${label} is at the lane edge`);
      else if (plan.kind === "blocked") setAnnouncement(`${label} cannot move further ${word}`);
      else {
        const coalesce = `keyboard:${session.current}:${selected.map((node) => node.id).join(",")}`;
        if (apply(dropAction(plan.drops), { coalesce })) setAnnouncement(`${label} moved ${word}`);
      }
    },
    [apply],
  );

  // Moving focus away ends a run of keyboard moves, so the next one is its own undo entry.
  const onBlur = useCallback(() => {
    session.current += 1;
  }, []);

  // The library announces onEdgesDelete before it removes anything, so a refusal could not be
  // undone there. Deleting through onBeforeDelete lets the loop decide: the gesture is turned into
  // one apply, the library is told not to delete, and the flow redraws from the changed loop.
  const onBeforeDelete = useCallback<OnBeforeDelete<GraphNode, DependencyFlowEdge>>(
    async ({ edges: doomed }) => {
      if (doomed.length) apply(disconnectAction(doomed));
      return false;
    },
    [apply],
  );

  const onNodeDragStart = useCallback<OnNodeDrag<GraphNode>>(() => {
    dragging.current = true;
    session.current += 1;
  }, []);

  const commitDrag = useCallback(
    (dragged: GraphNode[]) => {
      dragging.current = false;
      const moves = dragged.filter(isStepNode).map(({ id, position }) => ({ id, position }));
      const drops = planDrops(latest.current.loop, moves);
      if (!drops.length || !apply(dropAction(drops))) restore();
    },
    [apply, restore],
  );

  const onNodeDragStop = useCallback<OnNodeDrag<GraphNode>>(
    (_event, _node, dragged) => commitDrag(dragged),
    [commitDrag],
  );

  // Dragging a box-selected group moves it through the selection rectangle, which reports
  // onSelectionDrag* instead of onNodeDrag*; it commits exactly like a node drag.
  const onSelectionDragStart = useCallback((_event: unknown, _dragged: GraphNode[]) => {
    dragging.current = true;
    session.current += 1;
  }, []);

  const onSelectionDragStop = useCallback(
    (_event: unknown, dragged: GraphNode[]) => commitDrag(dragged),
    [commitDrag],
  );

  const onNodeClick = useCallback<NodeMouseHandler<GraphNode>>(
    (event, node) => {
      if (isStepNode(node))
        openDrawer(
          node.id,
          event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined,
        );
    },
    [openDrawer],
  );

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    isValidConnection,
    onConnect,
    reportConnectEnd,
    onKeyDown,
    onKeyDownCapture,
    onBlur,
    announcement,
    onBeforeDelete,
    onNodeDragStart,
    onNodeDragStop,
    onSelectionDragStart,
    onSelectionDragStop,
    onNodeClick,
  };
};
