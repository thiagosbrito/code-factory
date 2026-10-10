import {
  Controls,
  ReactFlow,
  type EdgeTypes,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
// The stylesheet is imported here, inside the lazily loaded module, so the main bundle never pays for it.
import "@xyflow/react/dist/style.css";
import type { LoopDefinition } from "../../../domain/loop.js";
import { useTheme } from "@/shared/theme";
import { DependencyEdge } from "./graph/DependencyEdge";
import { LaneNode } from "./graph/LaneNode";
import { StepNode } from "./graph/StepNode";
import type { Apply } from "./graph/graph-actions";
import type { DependencyFlowEdge, GraphNode } from "./graph/graph-mapping";
import { useGraphEditor } from "./graph/useGraphEditor";

const nodeTypes: NodeTypes = { step: StepNode, lane: LaneNode };
const edgeTypes: EdgeTypes = { dependency: DependencyEdge };

/** Snapping distance (px) from a target handle within which a released connection still connects. */
const CONNECTION_RADIUS = 40;

/** The smallest zoom the graph opens at; a taller loop is shown from its top-left instead. */
export const MIN_OPENING_ZOOM = 0.6;
const OPENING_MARGIN = 12;

/** Fits the whole graph, but never below a readable zoom: a big loop opens at its top-left. */
const openReadably = (instance: ReactFlowInstance<GraphNode, DependencyFlowEdge>) => {
  void instance.fitView({ padding: 0.08, minZoom: MIN_OPENING_ZOOM, maxZoom: 1 }).then(() => {
    const zoom = instance.getZoom();
    if (zoom <= MIN_OPENING_ZOOM + 0.001)
      return instance.setViewport({ x: OPENING_MARGIN, y: OPENING_MARGIN, zoom });
  });
};

export type LoopGraphViewProps = {
  loop: LoopDefinition;
  apply: Apply;
  openDrawer: (id: string, origin?: HTMLElement) => void;
};

/** The advanced editor view: the same draft as the Board, drawn as stage lanes, steps and edges. */
const LoopGraphView = ({ loop, apply, openDrawer }: LoopGraphViewProps) => {
  const { theme } = useTheme();
  const graph = useGraphEditor({ loop, apply, openDrawer });
  return (
    <section aria-label="Graph view" className="flex min-w-0 flex-col">
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">
        Drag from a step&apos;s right handle to another step&apos;s left handle to connect them.
        Select a connection and press Delete to remove it. Drop a step in another lane to change its
        stage.
      </p>
      <div className="h-[clamp(480px,75vh,900px)] min-w-0">
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={theme}
          onNodesChange={graph.onNodesChange}
          onEdgesChange={graph.onEdgesChange}
          onConnect={graph.onConnect}
          onConnectEnd={(_event, state) => graph.reportConnectEnd(state)}
          isValidConnection={graph.isValidConnection}
          onBeforeDelete={graph.onBeforeDelete}
          onNodeDragStart={graph.onNodeDragStart}
          onNodeDragStop={graph.onNodeDragStop}
          onSelectionDragStart={graph.onSelectionDragStart}
          onSelectionDragStop={graph.onSelectionDragStop}
          onNodeClick={graph.onNodeClick}
          connectionRadius={CONNECTION_RADIUS}
          // The library listens for Delete on the whole document. It is off so the wrapper handler
          // below can limit it to focus inside the graph; steps are also marked non-deletable.
          deleteKeyCode={null}
          onKeyDown={graph.onKeyDown}
          onKeyDownCapture={graph.onKeyDownCapture}
          tabIndex={-1}
          selectNodesOnDrag={false}
          onInit={openReadably}
          minZoom={0.3}
        >
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  );
};

export default LoopGraphView;
