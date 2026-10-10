import { z } from "zod";
import { catalogProblem } from "../domain/binding-catalog.js";
import { createRunRecord, createRunSnapshot, type RunRecord } from "../domain/run.js";
import { runBranchNameSchema, shortRunBranch } from "../domain/run-branch.js";
import { createKeyedLock } from "./keyed-lock.js";
import {
  assertSoleProjectWriter,
  createProjectRunBranch,
  rollbackProjectRunBranch,
} from "./run-branch.js";
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
    /** The run branch to create; defaults to the ticket ID, else `code-factory/<short id>`. */
    branch: runBranchNameSchema.optional(),
  })
  .refine(
    (input) => Boolean(input.description || input.ticketId),
    "Enter a description or ticket ID.",
  );
export type StartRunInput = z.infer<typeof startRunInputSchema>;

const activeRequests = new Map<string, { input: StartRunInput; work: Promise<RunRecord> }>();
/** One run start per project at a time, so two starts cannot both pass the single-writer check. */
const withProjectStart = createKeyedLock();

const matchesRequest = (record: RunRecord, input: StartRunInput): boolean => {
  return (
    record.snapshot.loop.id === input.loopId &&
    record.snapshot.loop.version === input.loopVersion &&
    record.snapshot.task.description === input.description &&
    (record.snapshot.task.ticket?.id ?? record.snapshot.task.ticketId) ===
      input.ticketId?.toUpperCase() &&
    (!input.branch || record.snapshot.baseline.branch === input.branch)
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
  const defaultBinding = config.defaultBinding;
  if (!defaultBinding) throw new ProjectError("Select and verify a default agent connection.", 422);
  for (const step of loop.steps) {
    const binding = step.binding ?? defaultBinding;
    const connection = agents.find((agent) => agent.provider === binding.provider);
    if (!connection?.protocol || connection.authentication !== "authenticated")
      throw new ProjectError(`Verify and authenticate ${binding.provider} before starting.`, 422);
    const problem = catalogProblem(connection, binding);
    if (problem === "model") throw new ProjectError(`Model ${binding.model} is unavailable.`, 422);
    if (problem) throw new ProjectError(`Effort ${binding.effort} is unavailable.`, 422);
  }
  const ticket = input.ticketId && tracker ? await tracker.retrieve(input.ticketId) : undefined;
  const ticketId = ticket?.id ?? input.ticketId?.toUpperCase() ?? "";
  const branch = input.branch ?? (ticketId || shortRunBranch(input.requestId));
  return withProjectStart(project, async () => {
    const raced = await readRun(project, input.requestId);
    if (raced) {
      if (!matchesRequest(raced, input))
        throw new ProjectError("This request ID already belongs to another run.", 409);
      return raced;
    }
    await assertSoleProjectWriter(project);
    const baseline = await createProjectRunBranch(project, { branch });
    try {
      return await createRun(
        project,
        createRunRecord(
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
            defaultBinding,
            baseline,
            input.requestId,
            config.setupCommand,
          ),
        ),
      );
    } catch (error) {
      // The branch has no commits yet: switch back and remove it so a failed start leaves no trace.
      await rollbackProjectRunBranch(project, baseline);
      throw error;
    }
  });
};
