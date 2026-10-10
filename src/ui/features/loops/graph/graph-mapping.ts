import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type { LoopDefinition } from "../../../../domain/loop.js";
import { stageOf, stages, type EditorStep, type Stage } from "../loop-editor-model";
import { groupRegions } from "./graph-regions";
import { continuations, edgeStructure, stepBadges, stepNotes } from "./graph-structure";
import {
  displayPositions,
  laneHeight,
  LANE_DRAWN_WIDTH,
  laneOriginX,
  NODE_HEIGHT,
  NODE_WIDTH,
} from "./graph-layout";

export type StepNodeData = {
  name: string;
  role: string;
  kind: EditorStep["kind"];
  stageLabel: string;
  /** Read-only structure badges; editing groups, joins and decisions stays on the Board. */
  badges: string[];
  /** Why a connection cannot start at this step, or null; also its output handle's tooltip. */
  startBlocked: string | null;
  /** Screen-reader text for the groups, join and decision the step belongs to. */
  note: string;
};
export type LaneNodeData = { stage: Stage; title: string; description: string };
export type RegionNodeData = { label: string; kind: "parallel" | "repeat" };

export type StepFlowNode = Node<StepNodeData, "step">;
export type LaneFlowNode = Node<LaneNodeData, "lane">;
export type RegionFlowNode = Node<RegionNodeData, "region">;
export type GraphNode = StepFlowNode | LaneFlowNode | RegionFlowNode;
export type DependencyEdgeData = {
  label: string;
  /** Decision outcomes that lead along this dependency; drawn as its label. */
  outcomes: string[];
  /** The mode of the join this dependency feeds, or null. */
  join: "all" | "any" | null;
};
export type DependencyFlowEdge = Edge<DependencyEdgeData, "dependency">;
export type ContinuationFlowEdge = Edge<{ label: string }, "continuation">;
export type GraphEdge = DependencyFlowEdge | ContinuationFlowEdge;

export const laneNodeId = (stage: string): string => `lane:${stage}`;
export const edgeId = (from: string, to: string): string => `${from}->${to}`;

/**
 * Handles are declared so edges can be drawn before the browser has measured any node (and in
 * jsdom). They must match the rendered handles exactly: the library keeps these bounds for hit
 * testing, so a wrong `id` (it must be null, like the default handle) or size breaks snapping.
 * The size is the `.graph-handle` size in styles.css; a handle straddles its node's edge.
 */
const HANDLE_SIZE = 12;
const handles = [
  {
    id: null,
    type: "target",
    position: Position.Left,
    x: -HANDLE_SIZE / 2,
    y: (NODE_HEIGHT - HANDLE_SIZE) / 2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
  },
  {
    id: null,
    type: "source",
    position: Position.Right,
    x: NODE_WIDTH - HANDLE_SIZE / 2,
    y: (NODE_HEIGHT - HANDLE_SIZE) / 2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
  },
] satisfies NonNullable<Node["handles"]>;

const stepNode = (
  loop: LoopDefinition,
  step: EditorStep,
  position: { x: number; y: number },
): StepFlowNode => {
  const stage = stageOf(step);
  const stageLabel = stages.find((item) => item.id === stage)?.name ?? stage;
  const { startBlocked, note } = stepNotes(loop, step);
  return {
    id: step.id,
    type: "step",
    position,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    handles,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    draggable: true,
    // Steps are never deleted from the graph; Delete and Backspace act on selected edges only.
    deletable: false,
    ariaLabel: `${step.name}, ${step.role}, ${step.kind} step in ${stageLabel}`,
    data: {
      name: step.name,
      role: step.role,
      kind: step.kind,
      stageLabel,
      badges: stepBadges(loop, step),
      startBlocked,
      note,
    },
  };
};

const laneNodes = (loop: LoopDefinition): LaneFlowNode[] => {
  const height = laneHeight(loop);
  return stages.map((stage) => ({
    id: laneNodeId(stage.id),
    type: "lane",
    position: { x: laneOriginX(stage.id), y: 0 },
    width: LANE_DRAWN_WIDTH,
    height,
    draggable: false,
    selectable: false,
    connectable: false,
    deletable: false,
    focusable: false,
    zIndex: -1,
    data: { stage: stage.id, title: stage.name, description: stage.description },
  }));
};

/**
 * One non-interactive region per group, drawn from the positions the steps have now (so it
 * follows a drag). Regions sit above the lanes and beneath the steps and are never part of the loop.
 */
export const regionNodes = (
  loop: LoopDefinition,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): RegionFlowNode[] =>
  groupRegions(loop, positions).map((region) => ({
    id: `region:${region.id}`,
    type: "region",
    position: { x: region.x, y: region.y },
    width: region.width,
    height: region.height,
    draggable: false,
    selectable: false,
    connectable: false,
    deletable: false,
    focusable: false,
    zIndex: -1,
    // Hit testing must see the lane, the steps and the edges beneath, never the region.
    style: { pointerEvents: "none" },
    data: { label: region.label, kind: region.kind },
  }));

/** Each repeat group's continuation as a view-only back arrow: no dependency, never selectable. */
export const continuationEdges = (loop: LoopDefinition): ContinuationFlowEdge[] =>
  continuations(loop).map((item) => ({
    id: `continue:${item.groupId}`,
    type: "continuation",
    source: item.from,
    target: item.to,
    animated: false,
    selectable: false,
    focusable: false,
    deletable: false,
    reconnectable: false,
    interactionWidth: 0,
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--graph-continue)" },
    ariaLabel: item.description,
    data: { label: item.label },
  }));

/** The whole flow derived from a loop: lanes first (drawn beneath), then steps, one edge per dependency. */
export const buildGraph = (
  loop: LoopDefinition,
): { nodes: GraphNode[]; edges: DependencyFlowEdge[] } => {
  const positions = displayPositions(loop);
  const names = new Map(loop.steps.map((step) => [step.id, step.name]));
  const label = (from: string, to: string) =>
    `Dependency from ${names.get(from) ?? from} to ${names.get(to) ?? to}`;
  return {
    nodes: [
      ...laneNodes(loop),
      ...loop.steps.map((step) => stepNode(loop, step, positions.get(step.id) ?? { x: 0, y: 0 })),
    ],
    edges: loop.dependencies.map(({ from, to }) => {
      const { outcomes, join } = edgeStructure(loop, from, to);
      return {
        id: edgeId(from, to),
        type: "dependency",
        source: from,
        target: to,
        // Never animated: motion is decoration here and must not ignore prefers-reduced-motion.
        animated: false,
        deletable: true,
        selectable: true,
        ...(join ? { className: "graph-edge-join" } : {}),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: join ? "var(--graph-join)" : "var(--graph-edge)",
        },
        ariaLabel: label(from, to),
        data: { label: label(from, to), outcomes, join },
      };
    }),
  };
};
