import { z } from "zod";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createRunRecord, createRunSnapshot, type RunRecord } from "../domain/run.js";
import { captureGitBaseline } from "./baseline.js";
import { ProjectError, readProjectConfig } from "./project.js";
import { createRun, readPublishedVersion, readRun } from "./storage.js";
import { ticketIdSchema, type TicketTracker } from "./tracker.js";
import type { AgentConnection } from "../adapters/contract.js";

export const startRunInputSchema = z
  .strictObject({
    requestId: z.uuid(),
    project: z.literal("selected"),
    loopId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    loopVersion: z.number().int().positive(),
    description: z.string().trim().max(20000),
    ticketId: ticketIdSchema.optional(),
  })
  .refine(
    (input) => Boolean(input.description || input.ticketId),
    "Enter a description or ticket ID.",
  );
export type StartRunInput = z.infer<typeof startRunInputSchema>;

const activeRequests = new Map<string, { input: StartRunInput; work: Promise<RunRecord> }>();

const matchesRequest = (record: RunRecord, input: StartRunInput): boolean => {
  return (
    record.snapshot.loop.id === input.loopId &&
    record.snapshot.loop.version === input.loopVersion &&
    record.snapshot.task.description === input.description &&
    (record.snapshot.task.ticket?.id ?? record.snapshot.task.ticketId) ===
      input.ticketId?.toUpperCase()
  );
};

export const startRun = async (
  project: string,
  raw: unknown,
  agents: AgentConnection[],
  tracker?: TicketTracker,
): Promise<RunRecord> => {
  const input = startRunInputSchema.parse(raw);
  const key = `${project}:${input.requestId}`;
  const running = activeRequests.get(key);
  if (running) {
    if (JSON.stringify(running.input) !== JSON.stringify(input))
      throw new ProjectError("This request ID is already starting another run.", 409);
    return running.work;
  }
  const work = startOnce(project, input, agents, tracker);
  activeRequests.set(key, { input, work });
  try {
    return await work;
  } finally {
    activeRequests.delete(key);
  }
};

const startOnce = async (
  project: string,
  input: StartRunInput,
  agents: AgentConnection[],
  tracker?: TicketTracker,
): Promise<RunRecord> => {
  const existing = await readRun(project, input.requestId);
  if (existing) {
    if (!matchesRequest(existing, input))
      throw new ProjectError("This request ID already belongs to another run.", 409);
    return existing;
  }
  const config = await readProjectConfig(project);
  if (!config) throw new ProjectError("Configure the project before starting a run.", 422);
  const loop = await readPublishedVersion(project, input.loopId, input.loopVersion);
  if (!loop) throw new ProjectError("Select a saved published loop.", 422);
  if (!config.defaultBinding)
    throw new ProjectError("Select and verify a default agent connection.", 422);
  for (const step of loop.steps) {
    const binding = step.binding ?? config.defaultBinding;
    const connection = agents.find((agent) => agent.provider === binding.provider);
    if (!connection?.protocol || connection.authentication !== "authenticated")
      throw new ProjectError(`Verify and authenticate ${binding.provider} before starting.`, 422);
    const model = connection.models?.find((item) => item.id === binding.model);
    if (binding.model !== "agent-default" && !model)
      throw new ProjectError(`Model ${binding.model} is unavailable.`, 422);
    if (binding.effort && !model?.efforts?.includes(binding.effort))
      throw new ProjectError(`Effort ${binding.effort} is unavailable.`, 422);
  }
  const ticket = input.ticketId && tracker ? await tracker.retrieve(input.ticketId) : undefined;
  const baseline = await captureGitBaseline(project).catch((error: unknown) => {
    throw new ProjectError(
      `Cannot capture Git baseline: ${error instanceof Error ? error.message : String(error)}`,
      422,
    );
  });
  try {
    const record = createRunRecord(
      createRunSnapshot(
        loop,
        {
          description: input.description,
          ...(ticket
            ? { ticket }
            : input.ticketId
              ? { ticketId: input.ticketId.toUpperCase() }
              : {}),
        },
        config.defaultBinding,
        baseline,
        input.requestId,
      ),
    );
    return await createRun(project, record);
  } catch (error) {
    if (baseline.workspace)
      await rm(join(project, baseline.workspace), { recursive: true, force: true });
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      const winner = await readRun(project, input.requestId);
      if (winner && matchesRequest(winner, input)) return winner;
      throw new ProjectError("This request ID already belongs to another run.", 409);
    }
    throw error;
  }
};
