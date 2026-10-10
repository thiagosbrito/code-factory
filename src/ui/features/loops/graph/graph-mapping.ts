import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type { LoopDefinition } from "../../../../domain/loop.js";
import { stageOf, stages, type EditorStep } from "../loop-editor-model";
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
};
export type LaneNodeData = { title: string; description: string };

export type StepFlowNode = Node<StepNodeData, "step">;
export type LaneFlowNode = Node<LaneNodeData, "lane">;
export type GraphNode = StepFlowNode | LaneFlowNode;
export type DependencyFlowEdge = Edge<{ label: string }, "dependency">;

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

const badgesOf = (loop: LoopDefinition, step: EditorStep): string[] => {
  const group = loop.groups.find((item) => item.id === step.groupId);
  const join = loop.joins.find((item) => item.stepId === step.id);
  const decision = loop.decisions.find((item) => item.stepId === step.id);
  return [
    ...(group ? [`${group.kind}: ${group.name}`] : []),
    ...(join ? [`join ${join.mode}`] : []),
    ...(decision
      ? [`decision: ${decision.branches.map((branch) => branch.outcome).join(" / ")}`]
      : []),
  ];
};

const stepNode = (
  loop: LoopDefinition,
  step: EditorStep,
  position: { x: number; y: number },
): StepFlowNode => {
  const stage = stageOf(step);
  const stageLabel = stages.find((item) => item.id === stage)?.name ?? stage;
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
      badges: badgesOf(loop, step),
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
    data: { title: stage.name, description: stage.description },
  }));
};

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
    edges: loop.dependencies.map(({ from, to }) => ({
      id: edgeId(from, to),
      type: "dependency",
      source: from,
      target: to,
      // Never animated: motion is decoration here and must not ignore prefers-reduced-motion.
      animated: false,
      deletable: true,
      selectable: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--graph-edge)" },
      ariaLabel: label(from, to),
      data: { label: label(from, to) },
    })),
  };
};
