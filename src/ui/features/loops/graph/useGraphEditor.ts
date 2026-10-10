import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  useEdgesState,
  useNodesState,
  type FinalConnectionState,
  type IsValidConnection,
  type OnConnect,
  type OnConnectEnd,
  type OnBeforeDelete,
  type OnNodeDrag,
  type NodeMouseHandler,
} from "@xyflow/react";
import type { LoopDefinition } from "../../../../domain/loop.js";
import {
  connectAction,
  connectionError,
  disconnectAction,
  dropAction,
  planDrops,
  type Apply,
} from "./graph-actions";
import {
  buildGraph,
  type DependencyFlowEdge,
  type GraphNode,
  type StepFlowNode,
} from "./graph-mapping";

const isStepNode = (node: GraphNode): node is StepFlowNode => node.type === "step";

/** Keeps the previous graph object while the derived content is identical, so reseeding is rare. */
const useStableGraph = (loop: LoopDefinition) => {
  const built = buildGraph(loop);
  const key = JSON.stringify(built);
  const [stable, setStable] = useState({ key, built });
  // Adjusting state during render is React's sanctioned way to derive state from props: React
  // re-renders at once, before anything is committed, so the effect below sees one new graph.
  if (stable.key !== key) setStable({ key, built });
  return stable.key === key ? stable.built : built;
};

/** The endpoints of a finished connection gesture, in dependency direction (source to target). */
const endpointsOf = (state: FinalConnectionState): { from: string; to: string } | null => {
  const dragged = state.fromNode?.id;
  const dropped = state.toNode?.id;
  if (!dragged || !dropped) return null;
  return state.fromHandle?.type === "target"
    ? { from: dropped, to: dragged }
    : { from: dragged, to: dropped };
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
  const seed = useStableGraph(loop);
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNode>(seed.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<DependencyFlowEdge>(seed.edges);
  // Handlers read the newest loop and graph through a ref, so they stay stable between renders.
  const latest = useRef({ loop, seed });
  useLayoutEffect(() => {
    latest.current = { loop, seed };
  }, [loop, seed]);

  useEffect(() => {
    setNodes(seed.nodes);
    setEdges(seed.edges);
  }, [seed, setNodes, setEdges]);

  const restore = useCallback(() => {
    setNodes(latest.current.seed.nodes);
    setEdges(latest.current.seed.edges);
  }, [setNodes, setEdges]);

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

  // A drop on a target the dry run refused never reaches onConnect, so the reason is reported here
  // through the same inline message by applying the refused action (it throws and changes nothing).
  const onConnectEnd = useCallback<OnConnectEnd>(
    (_event, state) => {
      const ends = state.isValid === false ? endpointsOf(state) : null;
      if (ends) apply(connectAction(ends.from, ends.to));
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

  const onNodeDragStop = useCallback<OnNodeDrag<GraphNode>>(
    (_event, _node, dragged) => {
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
    onConnectEnd,
    onBeforeDelete,
    onNodeDragStop,
    onNodeClick,
  };
};
