import { Controls, ReactFlow, type EdgeTypes, type NodeTypes } from "@xyflow/react";
// The stylesheet is imported here, inside the lazily loaded module, so the main bundle never pays for it.
import "@xyflow/react/dist/style.css";
import type { LoopDefinition } from "../../../domain/loop.js";
import { useTheme } from "@/shared/theme";
import { DependencyEdge } from "./graph/DependencyEdge";
import { LaneNode } from "./graph/LaneNode";
import { StepNode } from "./graph/StepNode";
import type { Apply } from "./graph/graph-actions";
import { useGraphEditor } from "./graph/useGraphEditor";

const nodeTypes: NodeTypes = { step: StepNode, lane: LaneNode };
const edgeTypes: EdgeTypes = { dependency: DependencyEdge };

/** Snapping distance (px) from a target handle within which a released connection still connects. */
const CONNECTION_RADIUS = 40;

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
      <div className="h-[640px] min-w-0">
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={theme}
          onNodesChange={graph.onNodesChange}
          onEdgesChange={graph.onEdgesChange}
          onConnect={graph.onConnect}
          onConnectEnd={graph.onConnectEnd}
          isValidConnection={graph.isValidConnection}
          onBeforeDelete={graph.onBeforeDelete}
          onNodeDragStop={graph.onNodeDragStop}
          onNodeClick={graph.onNodeClick}
          connectionRadius={CONNECTION_RADIUS}
          // Delete and Backspace remove selected edges only; steps are marked non-deletable.
          deleteKeyCode={["Backspace", "Delete"]}
          selectNodesOnDrag={false}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.3}
        >
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  );
};

export default LoopGraphView;
