import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { connectionRequestSchema, type ConnectionRegistry } from "./connections.js";
import {
  ProjectError,
  projectRevision,
  projectSetupSchema,
  readProjectConfig,
  saveProjectSetup,
} from "./project.js";
import { describeProjectTrust } from "./trust-review.js";
import { ticketIdSchema } from "./tracker.js";
import { json, readBody, type RouteHandler } from "./server-http.js";

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

/** Project setup, agent connection and ticket retrieval; the mutating half of the project API. */
export const handleProjectMutations: RouteHandler = async (ctx) => {
  const { request, response, pathname, projectDirectory, connections, tracker } = ctx;
  if (pathname === "/api/project/setup" && request.method === "PUT") {
    const parsed = projectSetupSchema.safeParse(await readBody(request));
    if (!parsed.success) {
      json(response, 400, { error: parsed.error.issues[0]?.message ?? "Invalid setup." });
      return true;
    }
    await validateDefaultBinding(parsed.data, connections);
    const project = await saveProjectSetup(projectDirectory, parsed.data);
    json(response, 200, { project, revision: await projectRevision(projectDirectory) });
    return true;
  }
  if (pathname === "/api/agents/connect" && request.method === "POST") {
    const parsed = connectionRequestSchema.safeParse(await readBody(request));
    if (!parsed.success) {
      json(response, 400, {
        error: parsed.error.issues[0]?.message ?? "Invalid connection request.",
      });
      return true;
    }
    json(response, 200, {
      connection: await connections.connect(parsed.data, ctx.authorizeLaunch),
    });
    return true;
  }
  if (pathname === "/api/tickets/retrieve" && request.method === "POST") {
    const body = await readBody(request);
    const parsed = ticketIdSchema.safeParse(
      body && typeof body === "object" && "id" in body ? body.id : undefined,
    );
    if (!parsed.success) {
      json(response, 400, { error: parsed.error.issues[0]?.message });
      return true;
    }
    if (!tracker) {
      json(response, 422, { error: "Configure a tracker before retrieving tickets." });
      return true;
    }
    json(response, 200, { ticket: await tracker.retrieve(parsed.data) });
    return true;
  }
  return false;
};

/** Health, project, factory counts, agents and tracker status; GET only. */
export const handleProjectReads: RouteHandler = async (ctx) => {
  const { response, pathname, projectDirectory, connections, tracker } = ctx;
  if (pathname === "/api/health") {
    json(response, 200, { status: "ready", mode: "foundation", executionAvailable: true });
    return true;
  }
  if (pathname === "/api/project") {
    json(response, 200, {
      project: await readProjectConfig(projectDirectory),
      path: projectDirectory,
      revision: await projectRevision(projectDirectory),
      trust: await describeProjectTrust(projectDirectory),
    });
    return true;
  }
  if (pathname === "/api/factory") {
    json(response, 200, {
      loops: await entryCount(join(projectDirectory, ".code-factory", "loops")),
      runs: await entryCount(join(projectDirectory, ".code-factory", "runs"), ".json"),
    });
    return true;
  }
  if (pathname === "/api/agents") {
    json(response, 200, { agents: await connections.list() });
    return true;
  }
  if (pathname === "/api/tracker") {
    json(response, 200, { configured: Boolean(tracker), provider: tracker ? "linear" : null });
    return true;
  }
  return false;
};
