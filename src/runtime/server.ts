import { createServer, type ServerResponse } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, resolve, sep } from "node:path";
import { discoverAgents } from "../adapters/discovery.js";
import { readProjectConfig } from "./project.js";

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

/** Bind only to loopback. Read-only foundation API; agent execution is not implemented here. */
export async function startLocalServer(options: {
  projectDirectory: string;
  port?: number;
  uiDirectory?: string;
  devOrigin?: string;
}) {
  const projectDirectory = await realpath(options.projectDirectory);
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
      if (request.method !== "GET")
        return json(response, 405, { error: "This foundation API is read-only" });
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", `http://${hosts[0]}`).pathname,
      );
      if (pathname === "/api/health")
        return json(response, 200, {
          status: "ready",
          mode: "foundation",
          executionAvailable: false,
        });
      if (pathname === "/api/project")
        return json(response, 200, { project: await readProjectConfig(projectDirectory) });
      if (pathname === "/api/agents")
        return json(response, 200, { agents: await discoverAgents() });
      if (pathname.startsWith("/api/")) return json(response, 404, { error: "Unknown endpoint" });
      return serveAsset(response, pathname, options.uiDirectory ?? defaultUiDirectory);
    })().catch((error: unknown) => {
      if (!response.headersSent) json(response, 500, { error: "Runtime request failed" });
      else response.end();
      console.error(error instanceof Error ? error.message : "Unknown runtime error");
    });
  });
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
