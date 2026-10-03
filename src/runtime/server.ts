import { createServer, type ServerResponse } from "node:http";
import { readFile, realpath, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join, resolve, sep } from "node:path";
import { ConnectionRegistry, connectionRequestSchema } from "./connections.js";
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

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 8192) throw new ProjectError("Request body is too large.", 413);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ProjectError("Send valid JSON.", 400);
  }
}

async function entryCount(directory: string, suffix?: string): Promise<number> {
  try {
    return (await readdir(directory, { withFileTypes: true })).filter((entry) =>
      suffix ? entry.isFile() && entry.name.endsWith(suffix) : entry.isDirectory(),
    ).length;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
}

async function serveAsset(response: ServerResponse, pathname: string, uiDirectory: string) {
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
}

/** Bind only to loopback; project setup writes to the CLI-selected workspace. */
export async function startLocalServer(options: {
  projectDirectory: string;
  port?: number;
  uiDirectory?: string;
  devOrigin?: string;
  connections?: ConnectionRegistry;
}) {
  const projectDirectory = await validateProjectDirectory(options.projectDirectory);
  const connections = options.connections ?? new ConnectionRegistry(projectDirectory);
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
        if (parsed.data.defaultBinding) {
          const binding = parsed.data.defaultBinding;
          const connection = (await connections.list()).find(
            (item) => item.provider === binding.provider,
          );
          if (!connection?.protocol || connection.authentication !== "authenticated")
            throw new ProjectError(
              "Verify and authenticate the selected agent before saving its default.",
              422,
            );
          const model = connection.models?.find((item) => item.id === binding.model);
          if (binding.model !== "agent-default" && !model)
            throw new ProjectError(
              "Selected model is unavailable in the current agent catalog.",
              422,
            );
          if (binding.effort && !model?.efforts?.includes(binding.effort))
            throw new ProjectError("Selected effort is unavailable for this model.", 422);
          if (
            binding.provider === "custom" &&
            (!parsed.data.customAgent ||
              (await realpath(parsed.data.customAgent.executable).catch(() => null)) !==
                connection.executable)
          )
            throw new ProjectError(
              "Verify the current custom executable before saving its default.",
              422,
            );
        }
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
      if (request.method !== "GET")
        return json(response, 405, { error: "Unsupported request method" });
      if (pathname === "/api/health")
        return json(response, 200, {
          status: "ready",
          mode: "foundation",
          executionAvailable: false,
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
      if (pathname.startsWith("/api/")) return json(response, 404, { error: "Unknown endpoint" });
      return serveAsset(response, pathname, options.uiDirectory ?? defaultUiDirectory);
    })().catch((error: unknown) => {
      if (!response.headersSent)
        json(response, error instanceof ProjectError ? error.status : 500, {
          error: error instanceof ProjectError ? error.message : "Runtime request failed",
        });
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
  return { server, url: `http://127.0.0.1:${address.port}` };
}
