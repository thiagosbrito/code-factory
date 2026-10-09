import { z } from "zod";
import { providerIdSchema, loopSchema } from "../../domain/loop.js";
import { runRecordSchema } from "../../domain/run.js";
import { evidenceSummarySchema } from "../../domain/acceptance.js";
import { eventSchema } from "../../domain/evidence.js";
import { projectConfigSchema } from "../../domain/project.js";
import { retrievedTicketSchema } from "../../domain/ticket.js";
import { runWorkspaceSchema } from "../../domain/run-branch.js";
import { projectTrustSchema } from "../../domain/trust.js";

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
    pause: capabilitySchema,
    waitingInput: capabilitySchema,
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
  trust: projectTrustSchema,
});
export const trustResponseSchema = z.object({ trust: projectTrustSchema });
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
export const runResponseSchema = z.object({
  run: runRecordSchema,
  /** Unfinished, but this runtime is not executing it: offer Resume. */
  interrupted: z.boolean().optional(),
});
export const evidenceResponseSchema = z.object({ summary: evidenceSummarySchema });
export const acceptedEvidenceResponseSchema = z.object({
  run: runRecordSchema,
  summary: evidenceSummarySchema,
});
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
export type SavedProjectResponse = z.infer<typeof savedProjectResponseSchema>;
/** A partial update to the App's one project state, from a save, grant, revoke or trust. */
export type ProjectPatch = Partial<ProjectResponse>;
export const workspaceResponseSchema = z.object({ workspace: runWorkspaceSchema });
export const promoteResponseSchema = z.object({
  run: runRecordSchema,
  warning: z.string().optional(),
});
export const promoteErrorSchema = z.object({
  error: z.string(),
  suggestedName: z.string().optional(),
});

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown = undefined,
  ) {
    super(message);
  }
}

/** Request options for a JSON body. */
export const jsonPost = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

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
    throw new ApiError(message, response.status, data);
  }
  return parse(data);
};
