import { useRef } from "react";
import { Button } from "@/shared/components/button";
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
import { ConfirmPanel } from "./graph/ConfirmPanel";
import { LinkDialog } from "./graph/LinkDialog";
import { useGraphLinking } from "./graph/useGraphLinking";
import { ContinuationEdge } from "./graph/ContinuationEdge";
import { LaneActionsProvider } from "./graph/LaneActions";
import { LaneNode } from "./graph/LaneNode";
import { RegionNode } from "./graph/RegionNode";
import { StepNode } from "./graph/StepNode";
import { StepFactsProvider, type ResolveStepFacts } from "./graph/StepFactsContext";
import type { Apply } from "./graph/graph-actions";
import type { GraphEdge, GraphNode } from "./graph/graph-mapping";
import { useGraphEditor } from "./graph/useGraphEditor";
import { type Stage, stages } from "./loop-editor-model";
import { addStepToLane } from "./loop-editor-add";

const noFacts: ResolveStepFacts = () => null;
const nodeTypes: NodeTypes = { step: StepNode, lane: LaneNode, region: RegionNode };
const edgeTypes: EdgeTypes = { dependency: DependencyEdge, continuation: ContinuationEdge };

/** Snapping distance (px) from a target handle within which a released connection still connects. */
const CONNECTION_RADIUS = 40;

/** The smallest zoom the graph opens at; a taller loop is shown from its top-left instead. */
export const MIN_OPENING_ZOOM = 0.6;
const OPENING_MARGIN = 12;

/** Fits the whole graph, but never below a readable zoom: a big loop opens at its top-left. */
const openReadably = (instance: ReactFlowInstance<GraphNode, GraphEdge>) => {
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
  /** Agent, model and effort shown on each step card. */
  stepFacts?: ResolveStepFacts;
};

/** The advanced editor view: the same draft as the Board, drawn as stage lanes, steps and edges. */
const LoopGraphView = ({ loop, apply, openDrawer, stepFacts }: LoopGraphViewProps) => {
  const { theme } = useTheme();
  const graph = useGraphEditor({ loop, apply, openDrawer });
  const section = useRef<HTMLElement>(null);
  const { warnings, confirm, cancel } = graph.confirmation;
  const linking = useGraphLinking({
    loop,
    apply,
    propose: graph.confirmation.propose,
    announce: graph.announce,
    openDrawer,
  });
  const selectedStep = graph.nodes.filter((node) => node.type === "step" && node.selected);
  const selectedId = selectedStep.length === 1 ? selectedStep[0]?.id : undefined;
  const selectedName = loop.steps.find((step) => step.id === selectedId)?.name;
  // Focus goes back to the step a dialog was opened from; if it is gone (Undo removed it), to the graph.
  const focusStep = (stepId: string | null) => {
    const step = stepId
      ? section.current?.querySelector<HTMLElement>(
          `.react-flow__node-step[data-id="${CSS.escape(stepId)}"]`,
        )
      : null;
    (step ?? section.current?.querySelector<HTMLElement>(".react-flow"))?.focus();
  };
  const laneActions = {
    addStep: (stage: Stage) => {
      if (apply((current) => addStepToLane(current, stage)))
        graph.announce(`Added a step to ${stages.find((item) => item.id === stage)?.name}`);
    },
  };
  return (
    <section ref={section} aria-label="Graph view" className="flex min-w-0 flex-col">
      {/* On a phone the help would push the canvas down: it folds away below md. */}
      <p className="hidden border-b px-4 py-2 text-xs text-muted-foreground md:block">
        Drag from a step&apos;s right handle to another step&apos;s left handle to connect them.
        Select a connection and press Delete to remove it. Drop a step in another lane to change its
        stage. By keyboard: Tab to a step, then Space selects it, C connects it, D disconnects it,
        Enter opens it, and Alt with an arrow moves to a neighbouring step. Groups, joins and
        decisions are shown here and edited in the Board view.
      </p>
      <details className="border-b px-4 py-2 text-xs text-muted-foreground md:hidden">
        <summary className="cursor-pointer font-medium">How to use the Graph</summary>
        <p className="mt-1">
          Drag from a step&apos;s right handle to another step&apos;s left handle to connect them.
          Select a connection and press Delete to remove it. Drop a step in another lane to change
          its stage. By keyboard: Tab to a step, then Space selects it, C connects it, D disconnects
          it, Enter opens it, and Alt with an arrow moves to a neighbouring step. Groups, joins and
          decisions are shown here and edited in the Board view.
        </p>
      </details>
      <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 border-b px-4 py-2 text-sm">
        <legend className="sr-only">Step connections</legend>
        <span className="text-muted-foreground">
          {selectedName
            ? `Selected: ${selectedName}`
            : "Focus a step and press Space to select it, then use these buttons"}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedId}
          onClick={() => selectedId && linking.open("connect", selectedId)}
        >
          Connect to…
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedId}
          onClick={() => selectedId && linking.open("disconnect", selectedId)}
        >
          Disconnect…
        </Button>
      </fieldset>
      <output aria-label="Graph announcements" className="sr-only">
        {graph.announcement}
      </output>
      <div className="h-[clamp(480px,75vh,900px)] min-w-0">
        <StepFactsProvider value={stepFacts ?? noFacts}>
          <LaneActionsProvider value={laneActions}>
            <ReactFlow
              nodes={graph.displayNodes}
              edges={graph.displayEdges}
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
              onKeyDownCapture={(event) => {
                if (!linking.onKeyCapture(event)) graph.onKeyDownCapture(event);
              }}
              onBlur={graph.onBlur}
              tabIndex={-1}
              selectNodesOnDrag={false}
              onInit={openReadably}
              minZoom={0.3}
            >
              <Controls showInteractive={false} />
            </ReactFlow>
          </LaneActionsProvider>
        </StepFactsProvider>
      </div>
      <LinkDialog
        loop={loop}
        request={linking.request}
        onConnect={linking.connect}
        onRefused={linking.refused}
        notice={linking.notice}
        onDisconnect={linking.disconnect}
        onClose={linking.close}
        onClosed={() => {
          const stepId = linking.dialogClosed();
          // A confirmation that follows takes focus itself; otherwise go back to the step.
          if (stepId) focusStep(stepId);
        }}
      />
      <ConfirmPanel
        warnings={warnings}
        onConfirm={confirm}
        onCancel={cancel}
        onClosed={() => focusStep(linking.confirmationClosed())}
      />
    </section>
  );
};

export default LoopGraphView;
