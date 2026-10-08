import { createServer, type ServerResponse } from "node:http";
import { readFile, realpath, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { z } from "zod";
import { extname, join, resolve, sep } from "node:path";
import { ConnectionRegistry, connectionRequestSchema } from "./connections.js";
import { listLoops, readDraft, readPublishedVersion, saveDraft, publishDraft } from "./storage.js";
import { parseLoop } from "../domain/loop.js";
import { startRun, startRunInputSchema } from "./intake.js";
import { cancelRun, executeRun, retryStep, withIdleRunSlot } from "./scheduler.js";
import { fileDigest, resolveRunWorkspace } from "./workspace.js";
import {
  assertProjectRunCanWrite,
  BranchNameError,
  describeRunWorkspace,
  promoteRun,
  removeRunWorktree,
  returnToPreviousBranch,
} from "./run-branch.js";
import { grantToolPermission, revokeToolPermission } from "./tool-grant.js";
import {
  grantableProviderSchema,
  toolGrantRequestSchema,
  toolGrantRevokeSchema,
} from "../domain/tool-grant.js";
import type { RunRecord } from "../domain/run.js";
import {
  applyNative,
  nativeCandidates,
  nativeFormats,
  previewNative,
} from "./native-translation.js";
import { acceptEvidence, summarizeEvidence } from "../domain/acceptance.js";
import { prepareStepRetry } from "../domain/scheduler.js";
import { guidanceInputSchema, sendGuidance } from "./guidance.js";
import { inputReplySchema, replyToInput } from "./input.js";
import { eventsAfter, parseEventCursor, streamRunEvents } from "./events.js";
import { inspectArtifact, inspectDiff, inspectFiles } from "./inspection.js";
import { listPublishedLoops, listRuns, mutateRun, readRun } from "./storage.js";
import { linearTracker, ticketIdSchema, type TicketTracker } from "./tracker.js";
import {
  ProjectError,
  projectRevision,
  projectSetupSchema,
  readProjectConfig,
  saveProjectSetup,
  validateProjectDirectory,
} from "./project.js";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const defaultUiDirectory = fileURLToPath(new URL("../../ui/", import.meta.url));

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};

const readBody = async (request: import("node:http").IncomingMessage): Promise<unknown> => {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 1_048_576) throw new ProjectError("Request body is too large.", 413);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new ProjectError("Send valid JSON.", 400);
  }
};

const entryCount = async (directory: string, suffix?: string): Promise<number> => {
  try {
    return (await readdir(directory, { withFileTypes: true })).filter((entry) =>
      suffix ? entry.isFile() && entry.name.endsWith(suffix) : entry.isDirectory(),
    ).length;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
};

const validateDefaultBinding = async (
  input: Parameters<typeof saveProjectSetup>[1],
  connections: ConnectionRegistry,
): Promise<void> => {
  const binding = input.defaultBinding;
  if (!binding) return;

  const connection = (await connections.list()).find((item) => item.provider === binding.provider);
  if (!connection?.protocol || connection.authentication !== "authenticated")
    throw new ProjectError(
      "Verify and authenticate the selected agent before saving its default.",
      422,
    );

  const model = connection.models?.find((item) => item.id === binding.model);
  if (binding.model !== "agent-default" && !model)
    throw new ProjectError("Selected model is unavailable in the current agent catalog.", 422);
  if (binding.effort && !model?.efforts?.includes(binding.effort))
    throw new ProjectError("Selected effort is unavailable for this model.", 422);

  if (binding.provider !== "custom") return;
  const configuredPath = input.customAgent?.executable;
  const verifiedPath = configuredPath ? await realpath(configuredPath).catch(() => null) : null;
  if (verifiedPath !== connection.executable)
    throw new ProjectError("Verify the current custom executable before saving its default.", 422);
};

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

const serveAsset = async (response: ServerResponse, pathname: string, uiDirectory: string) => {
  const root = resolve(uiDirectory);
  const path = resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);
  if (!path.startsWith(`${root}${sep}`)) return json(response, 403, { error: "Forbidden path" });
  try {
    const resolvedPath = await realpath(path);
    if (!resolvedPath.startsWith(`${await realpath(root)}${sep}`))
      return json(response, 403, { error: "Forbidden path" });
    const content = await readFile(resolvedPath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(path)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return json(response, 404, { error: "UI asset missing. Build the package or use pnpm dev." });
    throw error;
  }
};

/** Bind only to loopback; project setup writes to the CLI-selected workspace. */
export const startLocalServer = async (options: {
  projectDirectory: string;
  port?: number;
  uiDirectory?: string;
  devOrigin?: string;
  connections?: ConnectionRegistry;
  tracker?: TicketTracker;
}) => {
  const projectDirectory = await validateProjectDirectory(options.projectDirectory);
  const recoveryRuns = (await listRuns(projectDirectory)).filter((run) =>
    ["running", "waiting-input", "paused"].includes(run.status),
  );
  const connections = options.connections ?? new ConnectionRegistry(projectDirectory);
  const tracker =
    options.tracker ??
    (process.env.CODE_FACTORY_LINEAR_API_KEY
      ? linearTracker(process.env.CODE_FACTORY_LINEAR_API_KEY)
      : undefined);
  const server = createServer((request, response) => {
    void (async () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return json(response, 503, { error: "Runtime unavailable" });
      const hosts = [`127.0.0.1:${address.port}`, `localhost:${address.port}`];
      if (!request.headers.host || !hosts.includes(request.headers.host))
        return json(response, 403, { error: "Unrecognized host" });
      const allowedOrigins = hosts.map((host) => `http://${host}`);
      if (options.devOrigin) allowedOrigins.push(options.devOrigin);
      if (request.headers.origin && !allowedOrigins.includes(request.headers.origin))
        return json(response, 403, { error: "Unrecognized origin" });
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", `http://${hosts[0]}`).pathname,
      );
      if (pathname === "/api/project/setup" && request.method === "PUT") {
        const parsed = projectSetupSchema.safeParse(await readBody(request));
        if (!parsed.success)
          return json(response, 400, {
            error: parsed.error.issues[0]?.message ?? "Invalid setup.",
          });
        await validateDefaultBinding(parsed.data, connections);
        const project = await saveProjectSetup(projectDirectory, parsed.data);
        return json(response, 200, { project, revision: await projectRevision(projectDirectory) });
      }
      if (pathname === "/api/agents/connect" && request.method === "POST") {
        const parsed = connectionRequestSchema.safeParse(await readBody(request));
        if (!parsed.success)
          return json(response, 400, {
            error: parsed.error.issues[0]?.message ?? "Invalid connection request.",
          });
        return json(response, 200, { connection: await connections.connect(parsed.data) });
      }
      if (pathname === "/api/loops" && request.method === "GET")
        return json(response, 200, { loops: await listLoops(projectDirectory) });
      if (pathname === "/api/native/formats" && request.method === "GET")
        return json(response, 200, { formats: nativeFormats() });
      if (pathname === "/api/native/candidates" && request.method === "GET") {
        const format =
          new URL(request.url ?? "/", `http://${hosts[0]}`).searchParams.get("format") ?? "";
        return json(response, 200, { names: await nativeCandidates(projectDirectory, format) });
      }
      const nativePath = /^\/api\/native\/(import|export)\/(preview|apply)$/.exec(pathname);
      if (nativePath && request.method === "POST") {
        const input = await readBody(request);
        const direction = nativePath[1] as "import" | "export";
        return json(
          response,
          200,
          nativePath[2] === "preview"
            ? await previewNative(projectDirectory, input, direction)
            : await applyNative(projectDirectory, input, direction),
        );
      }
      const loopPath =
        /^\/api\/loops\/([a-z][a-z0-9-]{0,63})(?:\/(draft|publish|versions\/([1-9][0-9]*)))?$/.exec(
          pathname,
        );
      if (loopPath?.[1]) {
        const id = loopPath[1];
        const operation = loopPath[2];
        if (request.method === "GET" && operation === "draft")
          return json(response, 200, { loop: await readDraft(projectDirectory, id) });
        if (request.method === "GET" && operation?.startsWith("versions/"))
          return json(response, 200, {
            loop: await readPublishedVersion(projectDirectory, id, Number(loopPath[3])),
          });
        if (request.method === "PUT" && operation === "draft") {
          const loop = parseLoop(await readBody(request));
          if (loop.id !== id) throw new ProjectError("Loop path and draft ID differ.", 400);
          return json(response, 200, { loop: await saveDraft(projectDirectory, loop) });
        }
        if (request.method === "POST" && operation === "publish") {
          const draft = await readDraft(projectDirectory, id);
          if (!draft) throw new ProjectError("Save the draft before publishing.", 404);
          if (!draft.steps.length) throw new ProjectError("Add a step before publishing.", 422);
          const project = await readProjectConfig(projectDirectory);
          const agents = await connections.list();
          for (const step of draft.steps) {
            if (
              !step.expectedOutputs.length ||
              step.expectedOutputs.some((output) => !output.trim())
            )
              throw new ProjectError(`${step.name} needs nonempty expected outputs.`, 422);
            const binding = step.binding ?? project?.defaultBinding;
            if (!binding)
              throw new ProjectError(`${step.name} needs a project default or step binding.`, 422);
            const connection = agents.find((agent) => agent.provider === binding.provider);
            if (!connection?.protocol || connection.authentication !== "authenticated")
              throw new ProjectError(`${step.name} needs a verified, authenticated agent.`, 422);
            const model = connection.models?.find((item) => item.id === binding.model);
            if (binding.model !== "agent-default" && !model)
              throw new ProjectError(`${step.name} selects an unavailable model.`, 422);
            if (binding.effort && !model?.efforts?.includes(binding.effort))
              throw new ProjectError(`${step.name} selects an unavailable effort.`, 422);
          }
          return json(response, 200, { loop: await publishDraft(projectDirectory, id) });
        }
      }
      if (pathname === "/api/tickets/retrieve" && request.method === "POST") {
        const body = await readBody(request);
        const parsed = ticketIdSchema.safeParse(
          body && typeof body === "object" && "id" in body ? body.id : undefined,
        );
        if (!parsed.success) return json(response, 400, { error: parsed.error.issues[0]?.message });
        if (!tracker)
          return json(response, 422, { error: "Configure a tracker before retrieving tickets." });
        return json(response, 200, { ticket: await tracker.retrieve(parsed.data) });
      }
      if (pathname === "/api/runs" && request.method === "POST") {
        const parsed = startRunInputSchema.safeParse(await readBody(request));
        if (!parsed.success) return json(response, 400, { error: parsed.error.issues[0]?.message });
        try {
          const run = await startRun(
            projectDirectory,
            parsed.data,
            await connections.list(),
            tracker,
          );
          return json(response, 201, { runId: run.snapshot.id, run });
        } catch (error) {
          if (error instanceof BranchNameError)
            return json(response, error.status, {
              error: error.message,
              ...(error.suggestedName ? { suggestedName: error.suggestedName } : {}),
            });
          throw error;
        }
      }
      if (pathname === "/api/project/tool-grants" && request.method === "POST") {
        // Granting widens agent trust, so it requires a browser Origin from the Code Factory UI.
        if (!request.headers.origin || !allowedOrigins.includes(request.headers.origin))
          return json(response, 403, {
            error: "Tool permission can only be granted from the Code Factory UI.",
          });
        const parsed = toolGrantRequestSchema.safeParse(await readBody(request));
        if (!parsed.success)
          return json(response, 400, {
            error: parsed.error.issues[0]?.message ?? "Invalid tool permission request.",
          });
        const project = await grantToolPermission(
          projectDirectory,
          parsed.data.provider,
          parsed.data.revision,
        );
        return json(response, 200, { project, revision: await projectRevision(projectDirectory) });
      }
      const revokePath = /^\/api\/project\/tool-grants\/([a-z-]+)$/.exec(pathname);
      if (revokePath?.[1] && request.method === "DELETE") {
        const provider = grantableProviderSchema.safeParse(revokePath[1]);
        if (!provider.success)
          return json(response, 400, { error: "Unknown tool permission provider." });
        const parsed = toolGrantRevokeSchema.safeParse(await readBody(request));
        if (!parsed.success) return json(response, 400, { error: "Send the project revision." });
        const project = await revokeToolPermission(
          projectDirectory,
          provider.data,
          parsed.data.revision,
        );
        return json(response, 200, { project, revision: await projectRevision(projectDirectory) });
      }
      const workspacePath = /^\/api\/runs\/([0-9a-f-]{36})\/workspace$/i.exec(pathname);
      if (workspacePath?.[1] && request.method === "GET") {
        const run = await readRun(projectDirectory, workspacePath[1]);
        if (!run) return json(response, 404, { error: "Run not found." });
        return json(response, 200, {
          workspace: await describeRunWorkspace(projectDirectory, run),
        });
      }
      const promotePath = /^\/api\/runs\/([0-9a-f-]{36})\/promote$/i.exec(pathname);
      if (promotePath?.[1] && request.method === "POST") {
        try {
          return json(
            response,
            200,
            await promoteRun(projectDirectory, promotePath[1], await readBody(request)),
          );
        } catch (error) {
          if (error instanceof BranchNameError)
            return json(response, error.status, {
              error: error.message,
              ...(error.suggestedName ? { suggestedName: error.suggestedName } : {}),
            });
          throw error;
        }
      }
      const returnPath = /^\/api\/runs\/([0-9a-f-]{36})\/checkout\/return$/i.exec(pathname);
      if (returnPath?.[1] && request.method === "POST") {
        const runId = returnPath[1];
        // Hold the run's active slot so a retry cannot start while the checkout switches.
        const run = await withIdleRunSlot(projectDirectory, runId, () =>
          returnToPreviousBranch(projectDirectory, runId),
        );
        if (!run)
          return json(response, 409, { error: "Finish or cancel the run before switching back." });
        return json(response, 200, { run });
      }
      const removePath = /^\/api\/runs\/([0-9a-f-]{36})\/worktree\/remove$/i.exec(pathname);
      if (removePath?.[1] && request.method === "POST") {
        const runId = removePath[1];
        // Hold the run's active slot so a retry cannot start while Git removes the worktree.
        const run = await withIdleRunSlot(projectDirectory, runId, () =>
          removeRunWorktree(projectDirectory, runId),
        );
        if (!run)
          return json(response, 409, {
            error: "Finish or cancel the run before removing its worktree.",
          });
        return json(response, 200, { run });
      }
      const executePath = /^\/api\/runs\/([0-9a-f-]{36})\/execute$/i.exec(pathname);
      if (executePath?.[1] && request.method === "POST") {
        const run = await readRun(projectDirectory, executePath[1]);
        if (!run) return json(response, 404, { error: "Run not found." });
        if (run.status !== "pending" && run.status !== "running")
          return json(response, 409, { error: "Run cannot be started from its current state." });
        try {
          await assertProjectRunCanWrite(projectDirectory, run, {
            fresh: run.status === "pending" && !run.steps.some((step) => step.attempts.length),
          });
        } catch (error) {
          if (error instanceof ProjectError)
            return json(response, error.status, { error: error.message });
          throw error;
        }
        void executeRun(projectDirectory, executePath[1], (provider) =>
          connections.adapter(provider),
        ).catch((error: unknown) =>
          console.error(error instanceof Error ? error.message : "Run execution failed"),
        );
        return json(response, 202, { run });
      }
      const cancelPath = /^\/api\/runs\/([0-9a-f-]{36})\/cancel$/i.exec(pathname);
      if (cancelPath?.[1] && request.method === "POST") {
        const run = await cancelRun(projectDirectory, cancelPath[1]);
        return json(response, 200, { run });
      }
      const retryPath = /^\/api\/runs\/([0-9a-f-]{36})\/retry$/i.exec(pathname);
      if (retryPath?.[1] && request.method === "POST") {
        const parsed = z
          .strictObject({ stepId: z.string().min(1), attemptId: z.uuid() })
          .safeParse(await readBody(request));
        if (!parsed.success)
          return json(response, 400, { error: "Select a step and its latest attempt." });
        const run = await readRun(projectDirectory, retryPath[1]);
        if (!run) return json(response, 404, { error: "Run not found." });
        const { stepId, attemptId } = parsed.data;
        if (
          run.evidence.some(
            (item) =>
              item.kind === "event" &&
              item.title === "selected-step-retry" &&
              item.stepId === stepId &&
              item.attemptId === attemptId,
          )
        )
          return json(response, 200, { run });
        try {
          prepareStepRetry(run, stepId, attemptId);
          await resolveRunWorkspace(projectDirectory, run, { legacy: "prefix" });
          await assertProjectRunCanWrite(projectDirectory, run, { fresh: false });
        } catch (error) {
          return json(response, 409, {
            error: error instanceof Error ? error.message : "Retry unavailable.",
          });
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
        )
          return json(response, 422, {
            error: "Verify and authenticate this step's connection before retrying.",
          });
        void retryStep(projectDirectory, run.snapshot.id, stepId, attemptId, (provider) =>
          connections.adapter(provider),
        ).catch((error: unknown) =>
          console.error(error instanceof Error ? error.message : "Step retry failed"),
        );
        return json(response, 202, { run });
      }
      const guidancePath = /^\/api\/runs\/([0-9a-f-]{36})\/guidance$/i.exec(pathname);
      if (guidancePath?.[1] && request.method === "POST") {
        const parsed = guidanceInputSchema.safeParse(await readBody(request));
        if (!parsed.success) return json(response, 400, { error: parsed.error.issues[0]?.message });
        const run = await readRun(projectDirectory, guidancePath[1]);
        if (!run) return json(response, 404, { error: "Run not found." });
        const provider = run.snapshot.bindings[parsed.data.stepId]?.provider;
        const updated = await sendGuidance(
          projectDirectory,
          guidancePath[1],
          parsed.data,
          provider ? connections.adapter(provider) : null,
        );
        return json(response, 200, { run: updated });
      }
      const inputPath = /^\/api\/runs\/([0-9a-f-]{36})\/input$/i.exec(pathname);
      if (inputPath?.[1] && request.method === "POST") {
        const parsed = inputReplySchema.safeParse(await readBody(request));
        if (!parsed.success) return json(response, 400, { error: parsed.error.issues[0]?.message });
        const run = await readRun(projectDirectory, inputPath[1]);
        if (!run) return json(response, 404, { error: "Run not found." });
        const provider = run.snapshot.bindings[parsed.data.stepId]?.provider;
        const updated = await replyToInput(
          projectDirectory,
          inputPath[1],
          parsed.data,
          provider ? connections.adapter(provider) : null,
        );
        return json(response, 200, { run: updated });
      }
      const evidencePath = /^\/api\/runs\/([0-9a-f-]{36})\/evidence$/i.exec(pathname);
      if (evidencePath?.[1] && (request.method === "GET" || request.method === "POST")) {
        const run = await readRun(projectDirectory, evidencePath[1]);
        if (!run) return json(response, 404, { error: "Run not found." });
        const candidateId = await currentCandidate(projectDirectory, run);
        if (request.method === "GET")
          return json(response, 200, { summary: summarizeEvidence(run, candidateId) });
        try {
          let acceptedCandidate = candidateId;
          const accepted = await mutateRun(projectDirectory, evidencePath[1], async (current) => {
            acceptedCandidate = await currentCandidate(projectDirectory, current);
            if (!acceptedCandidate)
              throw new ProjectError("Current source candidate is unavailable.", 409);
            return acceptEvidence(current, acceptedCandidate);
          });
          return json(response, 200, {
            run: accepted,
            summary: summarizeEvidence(accepted, acceptedCandidate),
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "Current validation evidence is incomplete."
          )
            return json(response, 409, { error: error.message });
          throw error;
        }
      }
      if (request.method !== "GET")
        return json(response, 405, { error: "Unsupported request method" });
      if (pathname === "/api/health")
        return json(response, 200, {
          status: "ready",
          mode: "foundation",
          executionAvailable: true,
        });
      if (pathname === "/api/project")
        return json(response, 200, {
          project: await readProjectConfig(projectDirectory),
          path: projectDirectory,
          revision: await projectRevision(projectDirectory),
        });
      if (pathname === "/api/factory")
        return json(response, 200, {
          loops: await entryCount(join(projectDirectory, ".code-factory", "loops")),
          runs: await entryCount(join(projectDirectory, ".code-factory", "runs"), ".json"),
        });
      if (pathname === "/api/agents")
        return json(response, 200, { agents: await connections.list() });
      if (pathname === "/api/loops/published")
        return json(response, 200, { loops: await listPublishedLoops(projectDirectory) });
      if (pathname === "/api/runs")
        return json(response, 200, { runs: await listRuns(projectDirectory) });
      const inspectionPath =
        /^\/api\/runs\/([0-9a-f-]{36})\/inspection(?:\/(diff|artifact))?$/i.exec(pathname);
      if (inspectionPath?.[1]) {
        const run = await readRun(projectDirectory, inspectionPath[1]);
        if (!run) return json(response, 404, { error: "Run not found." });
        const url = new URL(request.url ?? "/", `http://${hosts[0]}`);
        if (inspectionPath[2] === "diff") {
          const path = url.searchParams.get("path");
          if (!path) return json(response, 400, { error: "Select a changed path." });
          return json(response, 200, await inspectDiff(projectDirectory, run, path));
        }
        if (inspectionPath[2] === "artifact") {
          const id = url.searchParams.get("id");
          if (!id) return json(response, 400, { error: "Select an artifact receipt." });
          return json(response, 200, await inspectArtifact(projectDirectory, run, id));
        }
        return json(response, 200, await inspectFiles(projectDirectory, run));
      }
      const eventsPath = /^\/api\/runs\/([0-9a-f-]{36})\/events$/i.exec(pathname);
      if (eventsPath?.[1]) {
        const run = await readRun(projectDirectory, eventsPath[1]);
        if (!run) return json(response, 404, { error: "Run not found." });
        const url = new URL(request.url ?? "/", `http://${hosts[0]}`);
        let cursor: number;
        try {
          const lastId = request.headers["last-event-id"];
          cursor = parseEventCursor(
            typeof lastId === "string" && lastId
              ? lastId
              : (url.searchParams.get("cursor") ?? undefined),
          );
        } catch {
          return json(response, 400, { error: "Invalid event cursor." });
        }
        if (request.headers.accept?.includes("text/event-stream"))
          return streamRunEvents(projectDirectory, eventsPath[1], response, cursor);
        const events = eventsAfter(run, cursor);
        return json(response, 200, {
          events,
          cursor: events.at(-1)?.sequence ?? cursor,
          revision: run.revision,
          status: run.status,
        });
      }
      if (pathname === "/api/tracker")
        return json(response, 200, {
          configured: Boolean(tracker),
          provider: tracker ? "linear" : null,
        });
      if (pathname.startsWith("/api/runs/")) {
        const id = pathname.slice("/api/runs/".length);
        if (!/^[0-9a-f-]{36}$/i.test(id)) return json(response, 400, { error: "Invalid run ID." });
        const run = await readRun(projectDirectory, id);
        return run
          ? json(response, 200, { run })
          : json(response, 404, { error: "Run not found." });
      }
      if (pathname.startsWith("/api/")) return json(response, 404, { error: "Unknown endpoint" });
      return serveAsset(response, pathname, options.uiDirectory ?? defaultUiDirectory);
    })().catch((error: unknown) => {
      if (!response.headersSent)
        json(
          response,
          error instanceof ProjectError ? error.status : error instanceof ZodError ? 422 : 500,
          {
            error:
              error instanceof ProjectError
                ? error.message
                : error instanceof ZodError
                  ? error.issues.map((issue) => issue.message).join("; ")
                  : "Runtime request failed",
          },
        );
      else response.end();
      console.error(error instanceof Error ? error.message : "Unknown runtime error");
    });
  });
  server.on("close", () => connections.close());
  await new Promise<void>((resolveStarted, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4310, "127.0.0.1", () => {
      server.off("error", reject);
      resolveStarted();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Runtime has no TCP address.");
  for (const run of recoveryRuns) {
    void executeRun(projectDirectory, run.snapshot.id, (provider) =>
      connections.adapter(provider),
    ).catch((error: unknown) =>
      console.error(error instanceof Error ? error.message : "Run recovery failed"),
    );
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
};
