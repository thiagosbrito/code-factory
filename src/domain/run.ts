import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  executionBindingSchema,
  parseLoop,
  type ExecutionBinding,
  type LoopDefinition,
} from "./loop.js";

export const taskSchema = z.strictObject({
  description: z.string().trim().min(1),
  ticket: z
    .strictObject({ id: z.string().min(1), title: z.string().min(1), summary: z.string().min(1) })
    .optional(),
});

export interface RunSnapshot {
  id: string;
  createdAt: string;
  task: z.infer<typeof taskSchema>;
  loop: LoopDefinition;
  bindings: Record<string, ExecutionBinding>;
}

/** Snapshot a published loop and resolve defaults once, independently of later edits. */
export function createRunSnapshot(
  loopInput: unknown,
  taskInput: unknown,
  defaultBinding: ExecutionBinding,
): RunSnapshot {
  const loop = parseLoop(loopInput);
  if (loop.status !== "published") throw new Error("Publish the loop before creating a run.");
  const task = taskSchema.parse(taskInput);
  const binding = executionBindingSchema.parse(defaultBinding);
  return structuredClone({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    task,
    loop,
    bindings: Object.fromEntries(loop.steps.map((step) => [step.id, step.binding ?? binding])),
  });
}
