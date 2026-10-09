import { z } from "zod";
import { acceptEvidence, summarizeEvidence } from "../domain/acceptance.js";
import type { RunRecord } from "../domain/run.js";
import { prepareStepRetry } from "../domain/scheduler.js";
import { guidanceInputSchema, sendGuidance } from "./guidance.js";
import { inputReplySchema, replyToInput } from "./input.js";
import { ProjectError } from "./project.js";
import { assertProjectRunCanWrite } from "./run-branch.js";
import { agentNotConnected, executeRun, isRunActive, retryStep } from "./scheduler.js";
import { mutateRun, readRun } from "./storage.js";
import { isProjectTrusted, projectNotTrusted } from "./trust.js";
import { fileDigest, resolveRunWorkspace } from "./workspace.js";
import { json, readBody, type RouteHandler } from "./server-http.js";

/**
 * Digest of the run's current candidate, or null when its workspace no longer resolves (a missing
 * worktree, or an in-project run whose checkout is on another branch).
 */
const currentCandidate = async (project: string, run: RunRecord): Promise<string | null> => {
  try {
    const resolved = await resolveRunWorkspace(project, run, { legacy: "prefix" });
    return await fileDigest(resolved.path, resolved.digestMode);
  } catch (error) {
    if (error instanceof ProjectError && (error.status === 404 || error.status === 409))
      return null;
    throw error;
  }
};

/** Execute, retry, guidance, input and evidence acceptance for one run. */
export const handleRunActions: RouteHandler = async (ctx) => {
  const { request, response, pathname, projectDirectory, connections, disconnectedProvider } = ctx;
  const executePath = /^\/api\/runs\/([0-9a-f-]{36})\/execute$/i.exec(pathname);
  if (executePath?.[1] && request.method === "POST") {
    const run = await readRun(projectDirectory, executePath[1]);
    if (!run) {
      json(response, 404, { error: "Run not found." });
      return true;
    }
    if (!(await isProjectTrusted(projectDirectory))) throw projectNotTrusted();
    // An interrupted run (waiting for input or paused when the runtime stopped) resumes here too.
    const resumable =
      ["waiting-input", "paused"].includes(run.status) &&
      !isRunActive(projectDirectory, run.snapshot.id);
    if (run.status !== "pending" && run.status !== "running" && !resumable) {
      json(response, 409, { error: "Run cannot be started from its current state." });
      return true;
    }
    const missing = disconnectedProvider(run);
    if (missing) {
      json(response, 409, { error: agentNotConnected(missing) });
      return true;
    }
    try {
      await assertProjectRunCanWrite(projectDirectory, run, {
        fresh: run.status === "pending" && !run.steps.some((step) => step.attempts.length),
      });
    } catch (error) {
      if (error instanceof ProjectError) {
        json(response, error.status, { error: error.message });
        return true;
      }
      throw error;
    }
    void executeRun(projectDirectory, executePath[1], (provider) =>
      connections.adapter(provider),
    ).catch((error: unknown) =>
      console.error(error instanceof Error ? error.message : "Run execution failed"),
    );
    json(response, 202, { run });
    return true;
  }
  const retryPath = /^\/api\/runs\/([0-9a-f-]{36})\/retry$/i.exec(pathname);
  if (retryPath?.[1] && request.method === "POST") {
    const parsed = z
      .strictObject({ stepId: z.string().min(1), attemptId: z.uuid() })
      .safeParse(await readBody(request));
    if (!parsed.success) {
      json(response, 400, { error: "Select a step and its latest attempt." });
      return true;
    }
    const run = await readRun(projectDirectory, retryPath[1]);
    if (!run) {
      json(response, 404, { error: "Run not found." });
      return true;
    }
    if (!(await isProjectTrusted(projectDirectory))) throw projectNotTrusted();
    const { stepId, attemptId } = parsed.data;
    if (
      run.evidence.some(
        (item) =>
          item.kind === "event" &&
          item.title === "selected-step-retry" &&
          item.stepId === stepId &&
          item.attemptId === attemptId,
      )
    ) {
      json(response, 200, { run });
      return true;
    }
    try {
      const missing = disconnectedProvider(run);
      if (missing) throw new Error(agentNotConnected(missing));
      prepareStepRetry(run, stepId, attemptId);
      await resolveRunWorkspace(projectDirectory, run, { legacy: "prefix" });
      await assertProjectRunCanWrite(projectDirectory, run, { fresh: false });
    } catch (error) {
      json(response, 409, {
        error: error instanceof Error ? error.message : "Retry unavailable.",
      });
      return true;
    }
    const definition = run.snapshot.loop.steps.find((item) => item.id === stepId);
    const binding = run.snapshot.bindings[stepId];
    const connection = (await connections.list()).find(
      (item) => item.provider === binding?.provider,
    );
    if (
      definition?.kind !== "check" &&
      (!binding ||
        !connections.adapter(binding.provider) ||
        (binding.provider !== "mock" && connection?.authentication !== "authenticated"))
    ) {
      json(response, 422, {
        error: "Verify and authenticate this step's connection before retrying.",
      });
      return true;
    }
    void retryStep(projectDirectory, run.snapshot.id, stepId, attemptId, (provider) =>
      connections.adapter(provider),
    ).catch((error: unknown) =>
      console.error(error instanceof Error ? error.message : "Step retry failed"),
    );
    json(response, 202, { run });
    return true;
  }
  const guidancePath = /^\/api\/runs\/([0-9a-f-]{36})\/guidance$/i.exec(pathname);
  if (guidancePath?.[1] && request.method === "POST") {
    const parsed = guidanceInputSchema.safeParse(await readBody(request));
    if (!parsed.success) {
      json(response, 400, { error: parsed.error.issues[0]?.message });
      return true;
    }
    const run = await readRun(projectDirectory, guidancePath[1]);
    if (!run) {
      json(response, 404, { error: "Run not found." });
      return true;
    }
    const provider = run.snapshot.bindings[parsed.data.stepId]?.provider;
    const updated = await sendGuidance(
      projectDirectory,
      guidancePath[1],
      parsed.data,
      provider ? connections.adapter(provider) : null,
    );
    json(response, 200, { run: updated });
    return true;
  }
  const inputPath = /^\/api\/runs\/([0-9a-f-]{36})\/input$/i.exec(pathname);
  if (inputPath?.[1] && request.method === "POST") {
    const parsed = inputReplySchema.safeParse(await readBody(request));
    if (!parsed.success) {
      json(response, 400, { error: parsed.error.issues[0]?.message });
      return true;
    }
    const run = await readRun(projectDirectory, inputPath[1]);
    if (!run) {
      json(response, 404, { error: "Run not found." });
      return true;
    }
    const provider = run.snapshot.bindings[parsed.data.stepId]?.provider;
    const updated = await replyToInput(
      projectDirectory,
      inputPath[1],
      parsed.data,
      provider ? connections.adapter(provider) : null,
    );
    json(response, 200, { run: updated });
    return true;
  }
  const evidencePath = /^\/api\/runs\/([0-9a-f-]{36})\/evidence$/i.exec(pathname);
  if (evidencePath?.[1] && (request.method === "GET" || request.method === "POST")) {
    const run = await readRun(projectDirectory, evidencePath[1]);
    if (!run) {
      json(response, 404, { error: "Run not found." });
      return true;
    }
    const candidateId = await currentCandidate(projectDirectory, run);
    if (request.method === "GET") {
      json(response, 200, { summary: summarizeEvidence(run, candidateId) });
      return true;
    }
    try {
      let acceptedCandidate = candidateId;
      const accepted = await mutateRun(projectDirectory, evidencePath[1], async (current) => {
        acceptedCandidate = await currentCandidate(projectDirectory, current);
        if (!acceptedCandidate)
          throw new ProjectError("Current source candidate is unavailable.", 409);
        return acceptEvidence(current, acceptedCandidate);
      });
      json(response, 200, {
        run: accepted,
        summary: summarizeEvidence(accepted, acceptedCandidate),
      });
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Current validation evidence is incomplete."
      ) {
        json(response, 409, { error: error.message });
        return true;
      }
      throw error;
    }
  }
  return false;
};
