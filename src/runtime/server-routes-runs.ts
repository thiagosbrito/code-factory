import { startRun, startRunInputSchema } from "./intake.js";
import { eventsAfter, parseEventCursor, streamRunEvents } from "./events.js";
import { inspectArtifact, inspectDiff, inspectFiles } from "./inspection.js";
import {
  BranchNameError,
  describeRunWorkspace,
  promoteRun,
  removeRunWorktree,
  returnToPreviousBranch,
} from "./run-branch.js";
import { cancelRun, isRunActive, withIdleRunSlot } from "./scheduler.js";
import { listRuns, readRun } from "./storage.js";
import { json, readBody, type RouteContext, type RouteHandler } from "./server-http.js";

const branchNameFailure = (response: RouteContext["response"], error: BranchNameError) =>
  json(response, error.status, {
    error: error.message,
    ...(error.suggestedName ? { suggestedName: error.suggestedName } : {}),
  });

/** Starting, promoting and tidying runs, and cancelling one; the mutating half of the runs API. */
export const handleRunMutations: RouteHandler = async (ctx) => {
  const { request, response, pathname, projectDirectory, connections, tracker } = ctx;
  if (pathname === "/api/runs" && request.method === "POST") {
    const parsed = startRunInputSchema.safeParse(await readBody(request));
    if (!parsed.success) {
      json(response, 400, { error: parsed.error.issues[0]?.message });
      return true;
    }
    try {
      const run = await startRun(projectDirectory, parsed.data, await connections.list(), tracker);
      json(response, 201, { runId: run.snapshot.id, run });
      return true;
    } catch (error) {
      if (error instanceof BranchNameError) {
        branchNameFailure(response, error);
        return true;
      }
      throw error;
    }
  }
  const workspacePath = /^\/api\/runs\/([0-9a-f-]{36})\/workspace$/i.exec(pathname);
  if (workspacePath?.[1] && request.method === "GET") {
    const run = await readRun(projectDirectory, workspacePath[1]);
    if (!run) {
      json(response, 404, { error: "Run not found." });
      return true;
    }
    json(response, 200, { workspace: await describeRunWorkspace(projectDirectory, run) });
    return true;
  }
  const promotePath = /^\/api\/runs\/([0-9a-f-]{36})\/promote$/i.exec(pathname);
  if (promotePath?.[1] && request.method === "POST") {
    try {
      json(
        response,
        200,
        await promoteRun(projectDirectory, promotePath[1], await readBody(request)),
      );
      return true;
    } catch (error) {
      if (error instanceof BranchNameError) {
        branchNameFailure(response, error);
        return true;
      }
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
    if (!run) {
      json(response, 409, { error: "Finish or cancel the run before switching back." });
      return true;
    }
    json(response, 200, { run });
    return true;
  }
  const removePath = /^\/api\/runs\/([0-9a-f-]{36})\/worktree\/remove$/i.exec(pathname);
  if (removePath?.[1] && request.method === "POST") {
    const runId = removePath[1];
    // Hold the run's active slot so a retry cannot start while Git removes the worktree.
    const run = await withIdleRunSlot(projectDirectory, runId, () =>
      removeRunWorktree(projectDirectory, runId),
    );
    if (!run) {
      json(response, 409, { error: "Finish or cancel the run before removing its worktree." });
      return true;
    }
    json(response, 200, { run });
    return true;
  }
  const cancelPath = /^\/api\/runs\/([0-9a-f-]{36})\/cancel$/i.exec(pathname);
  if (cancelPath?.[1] && request.method === "POST") {
    const run = await cancelRun(projectDirectory, cancelPath[1]);
    json(response, 200, { run });
    return true;
  }
  return false;
};

/**
 * The runs list, a run's inspection and event stream, then the run itself. The run-by-id route
 * is last: it answers any `/api/runs/...` path, so the specific routes must come first.
 */
export const handleRunReads: RouteHandler = async (ctx) => {
  const { request, response, pathname, projectDirectory } = ctx;
  if (pathname === "/api/runs") {
    json(response, 200, { runs: await listRuns(projectDirectory) });
    return true;
  }
  const inspectionPath = /^\/api\/runs\/([0-9a-f-]{36})\/inspection(?:\/(diff|artifact))?$/i.exec(
    pathname,
  );
  if (inspectionPath?.[1]) {
    const run = await readRun(projectDirectory, inspectionPath[1]);
    if (!run) {
      json(response, 404, { error: "Run not found." });
      return true;
    }
    if (inspectionPath[2] === "diff") {
      const path = ctx.url.searchParams.get("path");
      if (!path) {
        json(response, 400, { error: "Select a changed path." });
        return true;
      }
      json(response, 200, await inspectDiff(projectDirectory, run, path));
      return true;
    }
    if (inspectionPath[2] === "artifact") {
      const id = ctx.url.searchParams.get("id");
      if (!id) {
        json(response, 400, { error: "Select an artifact receipt." });
        return true;
      }
      json(response, 200, await inspectArtifact(projectDirectory, run, id));
      return true;
    }
    json(response, 200, await inspectFiles(projectDirectory, run));
    return true;
  }
  const eventsPath = /^\/api\/runs\/([0-9a-f-]{36})\/events$/i.exec(pathname);
  if (eventsPath?.[1]) {
    const run = await readRun(projectDirectory, eventsPath[1]);
    if (!run) {
      json(response, 404, { error: "Run not found." });
      return true;
    }
    let cursor: number;
    try {
      const lastId = request.headers["last-event-id"];
      cursor = parseEventCursor(
        typeof lastId === "string" && lastId
          ? lastId
          : (ctx.url.searchParams.get("cursor") ?? undefined),
      );
    } catch {
      json(response, 400, { error: "Invalid event cursor." });
      return true;
    }
    if (request.headers.accept?.includes("text/event-stream")) {
      await streamRunEvents(projectDirectory, eventsPath[1], response, cursor);
      return true;
    }
    const events = eventsAfter(run, cursor);
    json(response, 200, {
      events,
      cursor: events.at(-1)?.sequence ?? cursor,
      revision: run.revision,
      status: run.status,
    });
    return true;
  }
  if (pathname.startsWith("/api/runs/")) {
    const id = pathname.slice("/api/runs/".length);
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      json(response, 400, { error: "Invalid run ID." });
      return true;
    }
    const run = await readRun(projectDirectory, id);
    if (run)
      json(response, 200, {
        run,
        interrupted:
          ["running", "waiting-input", "paused"].includes(run.status) &&
          !isRunActive(projectDirectory, id),
      });
    else json(response, 404, { error: "Run not found." });
    return true;
  }
  return false;
};
