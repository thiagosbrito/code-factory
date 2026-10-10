import { createServer } from "node:http";
import { hasSession, sessionCookie, tokenMatches } from "./session.js";
import { ConnectionRegistry, type LaunchAuthorizer } from "./connections.js";
import { canonicalPath, isWithin } from "./launch-safety.js";
import type { RunRecord } from "../domain/run.js";
import { isProjectTrusted, projectNotTrusted } from "./trust.js";
import { linearTracker, type TicketTracker } from "./tracker.js";
import { readProjectConfig, validateProjectDirectory } from "./project.js";
import {
  json,
  respondWithError,
  SECURITY_HEADERS,
  type RouteContext,
  type RouteHandler,
} from "./server-http.js";
import { defaultUiDirectory, serveAsset } from "./server-static.js";
import { handleLoopReads, handleLoopRoutes } from "./server-routes-loops.js";
import { userConnectionMemory } from "./connection-memory.js";
import { handleProjectMutations, handleProjectReads } from "./server-routes-project.js";
import { handleRunActions } from "./server-routes-run-actions.js";
import { handleRunMutations, handleRunReads } from "./server-routes-runs.js";
import { handleTrustRoutes } from "./server-routes-trust.js";

export { SECURITY_HEADERS };

/**
 * Routes that may run for any method, tried in order until one answers. Each matches a distinct
 * method and path, so the order between modules does not decide a match.
 */
const mutatingRoutes: readonly RouteHandler[] = [
  handleProjectMutations,
  handleLoopRoutes,
  handleTrustRoutes,
  handleRunMutations,
  handleRunActions,
];

/**
 * GET-only routes, tried after the 405 gate. Within the runs module the run-by-id route is last
 * because it answers every `/api/runs/...` path.
 */
const readRoutes: readonly RouteHandler[] = [handleProjectReads, handleLoopReads, handleRunReads];

/** Bind only to loopback; project setup writes to the CLI-selected workspace. */
export const startLocalServer = async (options: {
  projectDirectory: string;
  /**
   * Required: the API session token, or null for an in-process harness that owns the runtime
   * (tests, a dev proxy that adds the token itself). See src/runtime/session.ts.
   */
  sessionToken: string | null;
  port?: number;
  uiDirectory?: string;
  devOrigin?: string;
  connections?: ConnectionRegistry;
  tracker?: TicketTracker;
  /** Remember connected agents per user and connect them again on the next start. */
  rememberConnections?: boolean;
}) => {
  const projectDirectory = await validateProjectDirectory(options.projectDirectory);
  const connections =
    options.connections ??
    new ConnectionRegistry(
      projectDirectory,
      undefined,
      undefined,
      undefined,
      undefined,
      options.rememberConnections ? userConnectionMemory(projectDirectory) : undefined,
    );
  // Agents, check and setup commands and Git all inherit this process's environment. The tracker
  // key is read once and removed, so it reaches the tracker and nothing the project runs.
  const linearKey = process.env.CODE_FACTORY_LINEAR_API_KEY;
  delete process.env.CODE_FACTORY_LINEAR_API_KEY;
  const tracker = options.tracker ?? (linearKey ? linearTracker(linearKey) : undefined);
  /**
   * The first agent provider that unfinished agent steps need but this runtime session has not
   * connected; checked before execute and retry so a run never starts work it cannot do.
   */
  const disconnectedProvider = (run: RunRecord): string | undefined =>
    run.snapshot.loop.steps
      .filter(
        (step) =>
          step.kind === "agent" &&
          run.steps.find((item) => item.stepId === step.id)?.status !== "succeeded",
      )
      .map((step) => run.snapshot.bindings[step.id]?.provider)
      .find((provider) => provider !== undefined && !connections.adapter(provider));
  /**
   * Until the project is trusted, an agent executable that is the project's content does not run:
   * one inside the project (a committed `node_modules/.bin/claude` that npx put on PATH, or a path
   * typed into the form) or the custom executable the project's own files saved, however spelled.
   * Paths compare by real path, so `./`, `//` and symlinked spellings find the same file.
   */
  const authorizeLaunch: LaunchAuthorizer = async (provider, executable) => {
    if (await isProjectTrusted(projectDirectory)) return;
    const [target, root] = await Promise.all([
      canonicalPath(executable),
      canonicalPath(projectDirectory),
    ]);
    if (isWithin(root, target)) throw projectNotTrusted();
    if (provider !== "custom") return;
    const saved = (await readProjectConfig(projectDirectory))?.customAgent?.executable;
    if (saved && (await canonicalPath(saved)) === target) throw projectNotTrusted();
  };
  const server = createServer((request, response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
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
      const requestUrl = new URL(request.url ?? "/", `http://${hosts[0]}`);
      const pathname = decodeURIComponent(requestUrl.pathname);
      const token = options.sessionToken;
      if (token !== null) {
        // The printed link exchanges its token for a cookie once, then leaves the address bar.
        if (pathname === "/" && requestUrl.searchParams.has("token")) {
          if (!tokenMatches(token, requestUrl.searchParams.get("token")))
            return json(response, 403, {
              error: "This link is not for the running Code Factory. Use the link it printed.",
            });
          response.writeHead(303, {
            Location: "/",
            "Set-Cookie": sessionCookie(token, address.port),
            "Cache-Control": "no-store",
          });
          return response.end();
        }
        if (pathname.startsWith("/api/") && !hasSession(request, token, address.port))
          return json(response, 401, {
            error: "Open Code Factory from the link `code-factory start` printed in your terminal.",
          });
      }
      const ctx: RouteContext = {
        request,
        response,
        pathname,
        url: requestUrl,
        allowedOrigins,
        projectDirectory,
        connections,
        tracker,
        authorizeLaunch,
        disconnectedProvider,
      };
      for (const route of mutatingRoutes) if (await route(ctx)) return;
      if (request.method !== "GET")
        return json(response, 405, { error: "Unsupported request method" });
      for (const route of readRoutes) if (await route(ctx)) return;
      if (pathname.startsWith("/api/")) return json(response, 404, { error: "Unknown endpoint" });
      return serveAsset(response, pathname, options.uiDirectory ?? defaultUiDirectory);
    })().catch((error: unknown) => respondWithError(response, error));
  });
  server.on("close", () => connections.close());
  await new Promise<void>((resolveStarted, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4310, "127.0.0.1", () => {
      server.off("error", reject);
      resolveStarted();
    });
  });
  // Agents the user connected before come back through the same launch authorization as Verify.
  if (options.rememberConnections) void connections.restore(authorizeLaunch);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Runtime has no TCP address.");
  // Unfinished runs are never resumed on start: the project's files may come from someone else.
  // The UI offers Resume for each interrupted run once the user trusts the project.
  const url = `http://127.0.0.1:${address.port}`;
  return {
    server,
    url,
    /** Where to open the UI: carries the session token when there is one. */
    loginUrl: options.sessionToken === null ? url : `${url}/?token=${options.sessionToken}`,
  };
};
