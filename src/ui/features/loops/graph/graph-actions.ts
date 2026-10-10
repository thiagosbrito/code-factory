import type { LoopDefinition } from "../../../../domain/loop.js";
import { addDependency, removeDependency, setStage } from "../loop-editor-dependencies";
import { moveVisual, stageOf } from "../loop-editor-model";
import {
  clampIntoLane,
  displayPositions,
  laneAtX,
  laneHeight,
  nudgeToFreeRow,
  type Point,
} from "./graph-layout";

/**
 * Pure decisions behind the Graph handlers. Each returns a loop transformation for the editor's
 * `apply`, which commits it as one undo entry or reports the thrown Error inline and keeps the loop.
 */
export type Apply = (action: (current: LoopDefinition) => LoopDefinition) => boolean;
export type LoopAction = (current: LoopDefinition) => LoopDefinition;

const hasEdge = (loop: LoopDefinition, from: string, to: string): boolean =>
  loop.dependencies.some((edge) => edge.from === from && edge.to === to);

/** A dry run of addDependency: the readable refusal, or null when the connection is allowed. */
export const connectionError = (loop: LoopDefinition, from: string, to: string): string | null => {
  try {
    addDependency(loop, from, to);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/** Connecting twice is a no-op (the library also fires onConnect for existing edges). */
export const connectAction =
  (from: string, to: string): LoopAction =>
  (current) =>
    hasEdge(current, from, to) ? current : addDependency(current, from, to);

/** Removes every listed dependency in one transformation, so a refusal leaves all of them in place. */
export const disconnectAction =
  (edges: { source: string; target: string }[]): LoopAction =>
  (current) =>
    edges.reduce((loop, edge) => removeDependency(loop, edge.source, edge.target), current);

/** An action that always refuses; `apply` shows its message inline and records no history. */
export const refuse =
  (message: string): LoopAction =>
  () => {
    throw new Error(message);
  };

type HandleKind = "source" | "target";
/** The part of the library's final connection state that decides whether to explain a refusal. */
export type ConnectEnd = {
  isValid: boolean | null;
  fromNode: { id: string } | null;
  toNode: { id: string } | null;
  fromHandle: { type: HandleKind } | null;
  toHandle: { type: HandleKind } | null;
};

/**
 * Why a released connection was refused, or null when there is nothing to explain. Only a drop the
 * library judged invalid on a handle of the OPPOSITE kind is explained: releasing an output on
 * another output (or an input on an input) is not an attempt to connect, and a release on the same
 * node or on empty canvas is not either. This only reads; it never builds a new loop.
 */
export const connectEndRefusal = (loop: LoopDefinition, end: ConnectEnd): string | null => {
  const { fromNode, toNode, fromHandle, toHandle } = end;
  if (end.isValid !== false || !fromNode || !toNode || !fromHandle || !toHandle) return null;
  if (fromNode.id === toNode.id || fromHandle.type === toHandle.type) return null;
  return fromHandle.type === "source"
    ? connectionError(loop, fromNode.id, toNode.id)
    : connectionError(loop, toNode.id, fromNode.id);
};

export type StepMove = { id: string; position: Point };
export type PlannedDrop = { id: string; stage: ReturnType<typeof stageOf>; position: Point };

/**
 * Resolves where dropped steps land: the lane under each node, an absolute position clamped into
 * that lane, and the nearest free row when it would sit on another node. Steps that end up exactly
 * where they are drawn are left out, so a click or a zero-length drag never writes a position.
 *
 * Positions are all-or-none: once a drop writes any position, every step that has none yet is
 * written at the position it is drawn at. The Runs graph reads a stored position as absolute and
 * lays out only the steps without one, so a partly positioned loop would overlap there.
 */
export const planDrops = (loop: LoopDefinition, moves: StepMove[]): PlannedDrop[] => {
  const drawn = displayPositions(loop);
  const height = laneHeight(loop);
  const occupied = new Map(
    loop.steps.map((step) => [step.id, { stage: stageOf(step), position: drawn.get(step.id) }]),
  );
  const placed: PlannedDrop[] = [];
  for (const move of moves) {
    const step = loop.steps.find((item) => item.id === move.id);
    if (!step) continue;
    const stage = laneAtX(move.position.x);
    const neighbours = [...occupied]
      .filter(([id, other]) => id !== step.id && other.stage === stage)
      .flatMap(([, other]) => (other.position ? [other.position] : []));
    const position = nudgeToFreeRow(
      clampIntoLane(stage, move.position, height),
      neighbours,
      height,
    );
    const current = drawn.get(step.id);
    if (stage === stageOf(step) && current?.x === position.x && current.y === position.y) continue;
    placed.push({ id: step.id, stage, position });
    occupied.set(step.id, { stage, position });
  }
  if (!placed.length) return [];
  const written = new Set(placed.map((drop) => drop.id));
  const fill = loop.steps.flatMap((step) => {
    const position = drawn.get(step.id);
    return step.position || written.has(step.id) || !position
      ? []
      : [{ id: step.id, stage: stageOf(step), position }];
  });
  return [...placed, ...fill];
};

/**
 * Applies the drops: a lane change goes through setStage (its refusals surface, nothing is
 * written), then the absolute position is stored. A step staying in its lane never calls setStage,
 * so group, join and decision members can still be arranged within their lane.
 */
export const dropAction =
  (drops: PlannedDrop[]): LoopAction =>
  (current) =>
    drops.reduce((loop, drop) => {
      const step = loop.steps.find((item) => item.id === drop.id);
      const staged =
        step && stageOf(step) !== drop.stage ? setStage(loop, drop.id, drop.stage) : loop;
      return moveVisual(staged, drop.id, drop.position.x, drop.position.y);
    }, current);
