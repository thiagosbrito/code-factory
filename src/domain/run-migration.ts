import { z } from "zod";
import { executionBindingSchema, parseLoop } from "./loop.js";

export const migrateRun = (input: unknown): unknown => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const value = z.record(z.string(), z.unknown()).parse(input);
  // The foundation's detached snapshots predated a schemaVersion field.
  if (
    value.schemaVersion !== 1 &&
    !(value.schemaVersion === undefined && "loop" in value && "bindings" in value)
  )
    return input;
  const loop = parseLoop(value.loop);
  const priorBindings =
    value.bindings && typeof value.bindings === "object" && !Array.isArray(value.bindings)
      ? z.record(z.string(), z.unknown()).parse(value.bindings)
      : {};
  const unboundStep = loop.steps.find((step) => !step.binding);
  const binding = executionBindingSchema.parse(
    value.projectDefault ??
      (unboundStep && priorBindings[unboundStep.id]) ??
      Object.values(priorBindings)[0],
  );
  return {
    ...value,
    schemaVersion: 2,
    loop,
    projectDefault: binding,
    baseline: value.baseline ?? {
      id: `legacy-${value.id}`,
      kind: "unversioned",
      capturedAt: value.createdAt,
    },
  };
};
