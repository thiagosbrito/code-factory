#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { discoverAgents } from "./adapters/discovery.js";
import { initializeProject } from "./runtime/project.js";
import { startLocalServer } from "./runtime/server.js";

const help = `Code Factory\n\n  code-factory init [directory]\n  code-factory doctor\n  code-factory start [--project directory] [--port 4310]\n\nInitialize a local project, inspect agent candidates, and open the local UI.\nConnect a supported agent in the UI before running agent-backed work.\n`;

const main = async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: "string" },
      port: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, directory] = positionals;
  if (values.help || !command) {
    console.log(help);
    return;
  }
  if (command === "init") {
    const config = await initializeProject(resolve(directory ?? values.project ?? process.cwd()));
    console.log(`Initialized ${config.name}. No agent, model, or loop was selected.`);
    return;
  }
  if (command === "doctor") {
    console.log(JSON.stringify(await discoverAgents(), null, 2));
    return;
  }
  if (command !== "start") throw new Error(`Unknown command: ${command}`);
  const port = Number(values.port ?? "4310");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Port must be between 0 and 65535; 0 selects an available port.");
  const { server, url } = await startLocalServer({
    projectDirectory: resolve(values.project ?? process.cwd()),
    port,
    ...(process.env.CODE_FACTORY_DEV_ORIGIN
      ? { devOrigin: process.env.CODE_FACTORY_DEV_ORIGIN }
      : {}),
  });
  console.log(`Code Factory: ${url}\nPress Ctrl+C to stop.`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close());
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Code Factory failed.");
  process.exitCode = 1;
});
