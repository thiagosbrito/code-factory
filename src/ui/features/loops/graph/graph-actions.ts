import type { LoopDefinition } from "../../../../domain/loop.js";
import { addDependency, removeDependency, setStage } from "../loop-editor-dependencies";
import { moveVisual, stageOf } from "../loop-editor-model";
import { clampIntoLane, displayPositions, laneAtX, laneHeight, type Point } from "./graph-layout";

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

export type StepMove = { id: string; position: Point };
export type PlannedDrop = { id: string; stage: ReturnType<typeof stageOf>; position: Point };

/**
 * Resolves where dropped steps land: the lane under each node and an absolute position clamped
 * into that lane. Steps that end up exactly where they are drawn are left out, so a click or a
 * zero-length drag never writes a position.
 */
export const planDrops = (loop: LoopDefinition, moves: StepMove[]): PlannedDrop[] => {
  const drawn = displayPositions(loop);
  const height = laneHeight(loop);
  return moves.flatMap((move) => {
    const step = loop.steps.find((item) => item.id === move.id);
    if (!step) return [];
    const stage = laneAtX(move.position.x);
    const position = clampIntoLane(stage, move.position, height);
    const current = drawn.get(step.id);
    const unchanged =
      stage === stageOf(step) && current?.x === position.x && current.y === position.y;
    return unchanged ? [] : [{ id: step.id, stage, position }];
  });
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
