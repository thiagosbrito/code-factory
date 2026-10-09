import { z } from "zod";
import { executionBindingSchema, parseLoop, loopSchema, type ExecutionBinding } from "./loop.js";
import { ticketIdSchema } from "./ticket.js";
import { setupCommandSchema, type SetupCommand } from "./project.js";

/**
 * A branch or revision read back from a run record and later passed to Git as an argument. Run
 * records can come from someone else's repository, so a value Git would read as an option (a
 * leading "-") or that is not a plausible ref is rejected when the record is parsed.
 */
export const storedGitRefSchema = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    // oxlint-disable-next-line no-control-regex -- control characters are exactly what is rejected.
    .refine((value) => !value.startsWith("-") && !/[\s\u0000-\u001f\u007f]|\.\./.test(value), {
      message: "Stored Git branch or revision is not a valid ref.",
    });

export const taskSchema = z
  .strictObject({
    description: z.string().trim(),
    ticketId: ticketIdSchema.optional(),
    ticket: z
      .strictObject({
        id: z.string().min(1),
        title: z.string().min(1),
        summary: z.string(),
        attachments: z
          .array(z.strictObject({ title: z.string().min(1), url: z.url() }))
          .default([]),
      })
      .optional(),
  })
  .refine(
    (task) => Boolean(task.description || task.ticketId || task.ticket),
    "Enter a description or ticket ID.",
  );

export const baselineSchema = z
  .strictObject({
    id: z.string().min(1),
    kind: z.enum(["git", "unversioned"]),
    revision: storedGitRefSchema(255).optional(),
    sourceRevision: storedGitRefSchema(255).optional(),
    workspace: z.string().min(1).optional(),
    branch: storedGitRefSchema(255).optional(),
    /** In-project runs only: what the checkout was on before the run switched it to `branch`. */
    checkout: z
      .strictObject({
        previousBranch: storedGitRefSchema(255).nullable(),
        previousRevision: storedGitRefSchema(255),
      })
      .optional(),
    changes: z.array(z.string()).optional(),
    capturedAt: z.iso.datetime(),
  })
  .refine((baseline) => baseline.kind !== "git" || Boolean(baseline.revision), {
    message: "Git baselines require a revision.",
    path: ["revision"],
  });

export type Baseline = z.infer<typeof baselineSchema>;

export const runSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(2),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  task: taskSchema,
  loop: loopSchema,
  projectDefault: executionBindingSchema,
  bindings: z.record(z.string(), executionBindingSchema),
  baseline: baselineSchema,
  setupCommand: setupCommandSchema.optional(),
});

export type RunSnapshot = z.infer<typeof runSnapshotSchema>;

/** Snapshot all inputs once; callers supply the actual protected baseline when available. */
export const createRunSnapshot = (
  loopInput: unknown,
  taskInput: unknown,
  defaultBinding: ExecutionBinding,
  baselineInput?: Baseline,
  id: string = crypto.randomUUID(),
  setupCommand?: SetupCommand,
): RunSnapshot => {
  const loop = parseLoop(loopInput);
  if (loop.status !== "published") throw new Error("Publish the loop before creating a run.");
  const task = taskSchema.parse(taskInput);
  const binding = executionBindingSchema.parse(defaultBinding);
  const baseline = baselineSchema.parse(
    baselineInput ?? {
      id: crypto.randomUUID(),
      kind: "unversioned",
      capturedAt: new Date().toISOString(),
    },
  );
  return runSnapshotSchema.parse(
    structuredClone({
      schemaVersion: 2,
      id,
      createdAt: new Date().toISOString(),
      task,
      loop,
      projectDefault: binding,
      bindings: Object.fromEntries(loop.steps.map((step) => [step.id, step.binding ?? binding])),
      baseline,
      ...(setupCommand ? { setupCommand } : {}),
    }),
  );
};
