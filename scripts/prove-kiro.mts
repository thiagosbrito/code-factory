import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ConnectionRegistry } from "../src/runtime/connections.js";
import { initializeProject, projectRevision, saveProjectSetup } from "../src/runtime/project.js";
import { startLocalServer } from "../src/runtime/server.js";
import { bindingError } from "../src/ui/connection.js";

// Explicit invocation launches one bounded native task using Kiro-owned authentication.
const root = await mkdtemp(join(tmpdir(), "factory-kiro-model-proof-"));
const model = process.env.KIRO_PROOF_MODEL ?? "claude-haiku-4.5";
const receipt: Record<string, unknown> = { startedAt: new Date().toISOString(), model };
let local: Awaited<ReturnType<typeof startLocalServer>> | undefined;
const stop = async () => {
  if (local) {
    local.server.closeAllConnections();
    await new Promise<void>((resolveClosed) => local?.server.close(() => resolveClosed()));
    local = undefined;
  }
};
try {
  await initializeProject(root);
  let registry = new ConnectionRegistry(root);
  local = await startLocalServer({ projectDirectory: root, port: 0, connections: registry });
  const connect = async () => {
    const response = await fetch(`${local?.url}/api/agents/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "kiro", launch: true }),
    });
    if (!response.ok) throw new Error(`Connection failed: ${await response.text()}`);
    return registry.list();
  };
  const connected = await connect();
  const binding = { provider: "kiro" as const, model };
  if (bindingError(binding, connected)) throw new Error(bindingError(binding, connected) ?? "");
  await saveProjectSetup(root, {
    name: "Disposable Kiro model proof",
    revision: await projectRevision(root),
    defaultBinding: binding,
  });
  receipt.catalogIds = connected
    .find((item) => item.provider === "kiro")
    ?.models?.map((item) => item.id);
  await stop();
  registry.close();
  registry = new ConnectionRegistry(root);
  local = await startLocalServer({ projectDirectory: root, port: 0, connections: registry });
  receipt.restartRequiresVerification = Boolean(bindingError(binding, await registry.list()));
  const reconnected = await connect();
  receipt.selectedModelUsableAfterVerification = bindingError(binding, reconnected) === null;
  const adapter = registry.adapter("kiro");
  if (!adapter) throw new Error("Verified Kiro adapter unavailable");
  const events = [];
  for await (const event of adapter.execute(
    {
      runId: "kiro-explicit-model-proof",
      stepId: "edit",
      attempt: 1,
      projectDirectory: root,
      binding,
      instruction:
        "Use fs_write to create selected-model.txt containing explicit-model-proof in this disposable project. Do not inspect other directories or use network. Reply briefly.",
    },
    AbortSignal.timeout(120000),
  )) {
    events.push({
      type: event.type,
      sessionId: event.sessionId,
      ...(event.type === "completed" ? { outcome: event.outcome } : {}),
    });
  }
  receipt.events = events;
  receipt.nativeEdit = (await readFile(join(root, "selected-model.txt"), "utf8")).includes(
    "explicit-model-proof",
  );
  receipt.completed = events.at(-1)?.outcome === "succeeded";
  receipt.version = execFileSync("kiro-cli", ["--version"], { encoding: "utf8" }).trim();
  registry.close();
  receipt.passed =
    receipt.nativeEdit &&
    receipt.completed &&
    receipt.restartRequiresVerification &&
    receipt.selectedModelUsableAfterVerification;
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  receipt.passed = false;
} finally {
  await stop();
  receipt.finishedAt = new Date().toISOString();
  await writeFile(
    resolve("docs/evidence/thi19-kiro-model-reconnect-proof-2026-10-06.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(receipt));
  if (!receipt.passed) process.exitCode = 1;
}
