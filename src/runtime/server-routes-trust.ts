import { trustRequestSchema } from "../domain/trust.js";
import { grantableProviderSchema, toolGrantRequestSchema } from "../domain/tool-grant.js";
import { listRuns } from "./storage.js";
import { cancelRun, isRunActive } from "./scheduler.js";
import {
  grantToolPermission,
  revokeToolPermission,
  trustProject,
  untrustProject,
} from "./trust.js";
import { describeProjectTrust } from "./trust-review.js";
import { json, readBody, type RouteHandler } from "./server-http.js";

/** Project trust and per-provider tool grants. Widening trust requires the UI's Origin. */
export const handleTrustRoutes: RouteHandler = async (ctx) => {
  const { request, response, pathname, projectDirectory, allowedOrigins } = ctx;
  if (pathname === "/api/project/tool-grants" && request.method === "POST") {
    // Granting widens agent trust, so it requires a browser Origin from the Code Factory UI.
    if (!request.headers.origin || !allowedOrigins.includes(request.headers.origin)) {
      json(response, 403, {
        error: "Tool permission can only be granted from the Code Factory UI.",
      });
      return true;
    }
    const parsed = toolGrantRequestSchema.safeParse(await readBody(request));
    if (!parsed.success) {
      json(response, 400, {
        error: parsed.error.issues[0]?.message ?? "Invalid tool permission request.",
      });
      return true;
    }
    await grantToolPermission(projectDirectory, parsed.data.provider);
    json(response, 200, { trust: await describeProjectTrust(projectDirectory) });
    return true;
  }
  if (pathname === "/api/project/trust" && request.method === "POST") {
    // Trust lets the project's commands run, so it also requires the Code Factory UI's Origin.
    if (!request.headers.origin || !allowedOrigins.includes(request.headers.origin)) {
      json(response, 403, { error: "A project can only be trusted from the Code Factory UI." });
      return true;
    }
    if (!trustRequestSchema.safeParse(await readBody(request)).success) {
      json(response, 400, { error: "Acknowledge what trusting this project allows." });
      return true;
    }
    await trustProject(projectDirectory);
    json(response, 200, { trust: await describeProjectTrust(projectDirectory) });
    return true;
  }
  if (pathname === "/api/project/trust" && request.method === "DELETE") {
    await untrustProject(projectDirectory);
    // Withdrawing trust also cancels the runs this runtime is executing in the project now, the
    // same as Cancel on each; their evidence stays.
    const active = (await listRuns(projectDirectory)).filter((run) =>
      isRunActive(projectDirectory, run.snapshot.id),
    );
    const results = await Promise.allSettled(
      active.map((run) => cancelRun(projectDirectory, run.snapshot.id)),
    );
    for (const result of results)
      if (result.status === "rejected")
        console.error(
          result.reason instanceof Error ? result.reason.message : "Run cancellation failed",
        );
    json(response, 200, { trust: await describeProjectTrust(projectDirectory) });
    return true;
  }
  const revokePath = /^\/api\/project\/tool-grants\/([a-z-]+)$/.exec(pathname);
  if (revokePath?.[1] && request.method === "DELETE") {
    const provider = grantableProviderSchema.safeParse(revokePath[1]);
    if (!provider.success) {
      json(response, 400, { error: "Unknown tool permission provider." });
      return true;
    }
    await revokeToolPermission(projectDirectory, provider.data);
    json(response, 200, { trust: await describeProjectTrust(projectDirectory) });
    return true;
  }
  return false;
};
