import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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
  refuse,
  type Apply,
  type ConnectEnd,
} from "./graph-actions";
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

/** Typing in a field must never be read as a graph shortcut. */
const isTextTarget = (target: EventTarget): boolean =>
  target instanceof HTMLElement &&
  target.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

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
  const latest = useRef({ loop, seed, edges });
  useLayoutEffect(() => {
    latest.current = { loop, seed, edges };
  }, [loop, seed, edges]);
  // A reseed during a drag (for example Undo pressed mid-drag) would yank the node from under the
  // pointer; the drop handler reconciles with the newest loop once the drag ends.
  const dragging = useRef(false);

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
  // while focus is inside the graph and never while typing or on a toolbar button.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if ((event.key !== "Delete" && event.key !== "Backspace") || isTextTarget(event.target))
        return;
      const doomed = latest.current.edges.filter((edge) => edge.selected);
      if (!doomed.length) return;
      event.preventDefault();
      apply(disconnectAction(doomed));
    },
    [apply],
  );

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
  }, []);

  const onNodeDragStop = useCallback<OnNodeDrag<GraphNode>>(
    (_event, _node, dragged) => {
      dragging.current = false;
      const moves = dragged.filter(isStepNode).map(({ id, position }) => ({ id, position }));
      const drops = planDrops(latest.current.loop, moves);
      if (!drops.length || !apply(dropAction(drops))) restore();
    },
    [apply, restore],
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
    onBeforeDelete,
    onNodeDragStart,
    onNodeDragStop,
    onNodeClick,
  };
};
