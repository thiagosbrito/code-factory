#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const REQUIRED_NODE = [22, 12] as const;

// Checked before any runtime module loads, so an old Node fails with this message and not with a
// syntax or missing-API error from deep inside the runtime.
const requireSupportedNode = () => {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major > REQUIRED_NODE[0] || (major === REQUIRED_NODE[0] && minor >= REQUIRED_NODE[1])) return;
  console.error(
    `Code Factory needs Node ${REQUIRED_NODE.join(".")} or newer (you have ${process.versions.node}).`,
  );
  process.exit(1);
};

const help = `Code Factory\n\n  code-factory init [directory]\n  code-factory doctor\n  code-factory start [--project directory] [--port 4310] [--no-open]\n  code-factory --version\n\nInitialize a local project, inspect agent candidates, and open the local UI.\nConnect a supported agent in the UI before running agent-backed work.\n`;

/** Reads the version from the package.json beside the built CLI (dist/node) or the source (src). */
const packageVersion = (): string => {
  for (const relative of ["../../package.json", "../package.json"]) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
      if (typeof parsed === "object" && parsed !== null && "version" in parsed)
        return String(parsed.version);
    } catch {
      // Try the next layout.
    }
  }
  return "unknown";
};

const openInBrowser = (url: string) => {
  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url.replaceAll("&", "^&")]]
        : ["xdg-open", [url]];
  // Best effort: the printed link always works, so a missing opener is not an error.
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => undefined);
  child.unref();
};

const listenFailure = (error: unknown, port: number): Error | undefined => {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : "";
  if (code === "EADDRINUSE")
    return new Error(`Port ${port} is already in use. Pick another with --port, or use --port 0.`);
  if (code === "EACCES")
    return new Error(`Port ${port} cannot be used (permission denied). Try --port 0.`);
  return undefined;
};

const main = async () => {
  requireSupportedNode();
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: "string" },
      port: { type: "string" },
      "no-open": { type: "boolean" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.version) {
    console.log(packageVersion());
    return;
  }
  const [command, directory] = positionals;
  if (values.help || !command) {
    console.log(help);
    return;
  }
  if (command === "init") {
    const { initializeProject } = await import("./runtime/project.js");
    const config = await initializeProject(resolve(directory ?? values.project ?? process.cwd()));
    console.log(`Initialized ${config.name}. No agent, model, or loop was selected.`);
    return;
  }
  if (command === "doctor") {
    const { discoverAgents } = await import("./adapters/discovery.js");
    console.log(JSON.stringify(await discoverAgents(), null, 2));
    return;
  }
  if (command !== "start") throw new Error(`Unknown command: ${command}`);
  const port = Number(values.port ?? "4310");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Port must be between 0 and 65535; 0 selects an available port.");
  const { startLocalServer } = await import("./runtime/server.js");
  const { createSessionToken } = await import("./runtime/session.js");
  const { server, loginUrl } = await startLocalServer({
    projectDirectory: resolve(values.project ?? process.cwd()),
    sessionToken: createSessionToken(),
    port,
    ...(process.env.CODE_FACTORY_DEV_ORIGIN
      ? { devOrigin: process.env.CODE_FACTORY_DEV_ORIGIN }
      : {}),
  }).catch((error: unknown) => {
    throw listenFailure(error, port) ?? error;
  });
  console.log(
    `Code Factory: ${loginUrl}\nOpen this link to use it; it carries this session's access token.\nPress Ctrl+C to stop.`,
  );
  // Only for an interactive terminal: scripts and the package smoke test must not spawn a browser.
  if (!values["no-open"] && process.stdout.isTTY) openInBrowser(loginUrl);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close());
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Code Factory failed.");
  process.exitCode = 1;
});
