import { z } from "zod";
import { providerIdSchema, loopSchema } from "../domain/loop.js";
import { runRecordSchema } from "../domain/run.js";
import { eventSchema } from "../domain/evidence.js";
import { projectConfigSchema } from "../domain/project.js";
import { retrievedTicketSchema } from "../domain/ticket.js";

const capabilitySchema = z.enum(["supported", "unsupported", "unknown"]);
export const agentConnectionSchema = z.object({
  provider: providerIdSchema,
  executable: z.string().nullable(),
  installation: z.enum(["detected", "missing", "built-in"]),
  authentication: z.enum(["unknown", "not-required", "authenticated", "unauthenticated"]),
  authenticationMechanism: z.string().optional(),
  capabilities: z.object({
    streaming: capabilitySchema,
    steering: capabilitySchema,
    resume: capabilitySchema,
  }),
  version: z.string().optional(),
  protocol: z.string().optional(),
  identity: z.string().optional(),
  reason: z.string().optional(),
  models: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.string(),
        efforts: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});
export const projectResponseSchema = z.object({
  project: projectConfigSchema.nullable(),
  path: z.string(),
  revision: z.string().nullable(),
});
export type ProjectResponse = z.infer<typeof projectResponseSchema>;
export const factoryResponseSchema = z.object({ loops: z.number(), runs: z.number() });
export type FactoryResponse = z.infer<typeof factoryResponseSchema>;
export const agentsResponseSchema = z.object({ agents: z.array(agentConnectionSchema) });
export const connectionResponseSchema = z.object({ connection: agentConnectionSchema });
export const loopResponseSchema = z.object({ loop: loopSchema });
export const publishedLoopsResponseSchema = z.object({ loops: z.array(loopSchema) });
export const loopEntriesResponseSchema = z.object({
  loops: z.array(
    z.object({
      id: z.string(),
      draft: loopSchema.nullable(),
      published: loopSchema.nullable(),
      versions: z.array(z.number()).default([]),
    }),
  ),
});
export const runsResponseSchema = z.object({ runs: z.array(runRecordSchema) });
export const runResponseSchema = z.object({ run: runRecordSchema });
export const executionEventSchema = eventSchema;
export const startedRunResponseSchema = z.object({
  runId: z.string(),
  run: runRecordSchema.optional(),
});
export const trackerStatusResponseSchema = z.object({ configured: z.boolean() });
export const ticketResponseSchema = z.object({ ticket: retrievedTicketSchema });
export const savedProjectResponseSchema = z.object({
  project: projectConfigSchema,
  revision: z.string(),
});

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const api = async <T>(
  path: string,
  parse: (data: unknown) => T,
  options?: RequestInit,
): Promise<T> => {
  const response = await fetch(path, options);
  const data: unknown = await response.json();
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return parse(data);
};
