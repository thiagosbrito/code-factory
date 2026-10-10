import type { LoopDefinition } from "../../../domain/loop.js";
import { addStep, type Stage } from "./loop-editor-model";
import { completePositions } from "./loop-editor-placement";

/** The Board's and the Graph's per-lane add: a check in Validate, an agent step elsewhere. */
export const addStepToLane = (loop: LoopDefinition, stage: Stage): LoopDefinition =>
  completePositions(addStep(loop, stage, stage === "validation" ? "check" : "agent"));
