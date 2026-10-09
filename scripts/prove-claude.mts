import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { StepExecutionInput } from "../src/adapters/contract.js";
import { ConnectionRegistry } from "../src/runtime/connections.js";
import { initializeProject, projectRevision, saveProjectSetup } from "../src/runtime/project.js";
import { startLocalServer } from "../src/runtime/server.js";
import { bindingError } from "../src/ui/shared/connection.js";

// Explicit invocation launches three bounded native steps using Claude Code-owned authentication.
const root = await mkdtemp(join(tmpdir(), "factory-claude-proof-"));
const model = process.env.CLAUDE_PROOF_MODEL ?? "haiku";
const effort = process.env.CLAUDE_PROOF_EFFORT ?? "low";
const receipt: Record<string, unknown> = { startedAt: new Date().toISOString(), model, effort };
const exists = (name: string) =>
  access(join(root, name)).then(
    () => true,
    () => false,
  );
let local: Awaited<ReturnType<typeof startLocalServer>> | undefined;
const registry = new ConnectionRegistry(root);
try {
  await initializeProject(root);
  local = await startLocalServer({
    sessionToken: null,
    projectDirectory: root,
    port: 0,
    connections: registry,
  });
  const response = await fetch(`${local.url}/api/agents/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "claude-code", launch: true }),
  });
  if (!response.ok) throw new Error(`Connection failed: ${await response.text()}`);
  const connected = await registry.list();
  const binding = { provider: "claude-code" as const, model, effort };
  const invalid = bindingError(binding, connected);
  if (invalid) throw new Error(invalid);
  await saveProjectSetup(root, {
    name: "Disposable Claude Code proof",
    revision: await projectRevision(root),
    defaultBinding: binding,
  });
  const connection = connected.find((item) => item.provider === "claude-code");
  receipt.connection = {
    authentication: connection?.authentication,
    version: connection?.version,
    protocol: connection?.protocol,
  };
  const adapter = registry.adapter("claude-code");
  if (!adapter) throw new Error("Verified Claude Code adapter unavailable");
  const step = async (stepId: string, instruction: string, extra: Partial<StepExecutionInput>) => {
    const events: { type: string; title?: string; state?: string; outcome?: string }[] = [];
    for await (const event of adapter.execute(
      {
        runId: "claude-proof",
        stepId,
        attempt: 1,
        projectDirectory: root,
        binding,
        instruction,
        ...extra,
      },
      AbortSignal.timeout(180_000),
    ))
      events.push({
        type: event.type,
        ...(event.type === "tool" ? { title: event.title, state: event.state } : {}),
        ...(event.type === "completed" ? { outcome: event.outcome } : {}),
      });
    return events;
  };
  const rules =
    "This is a disposable test project. Do not inspect other directories or use the network. If a tool is unavailable or denied, do not work around it; continue and reply briefly.";

  receipt.writer = await step(
    "writer",
    `${rules} 1. Use the Write tool to create claude-proof.txt containing exactly: native-edit. 2. Use the Bash tool to run: touch writer-bash.txt`,
    {},
  );
  receipt.writerEdited = (await readFile(join(root, "claude-proof.txt"), "utf8")).includes(
    "native-edit",
  );
  receipt.writerBashDenied = !(await exists("writer-bash.txt"));

  receipt.reviewer = await step(
    "reviewer",
    `${rules} 1. Use the Write tool to create reviewer-write.txt containing: x. 2. Use the Bash tool to run: touch reviewer-bash.txt. 3. Reply with one line: pass`,
    { readOnly: true },
  );
  receipt.reviewerWriteDenied = !(await exists("reviewer-write.txt"));
  receipt.reviewerBashDenied = !(await exists("reviewer-bash.txt"));

  receipt.granted = await step(
    "granted",
    `${rules} Use the Bash tool to run: touch granted-bash.txt`,
    {
      toolGrant: { provider: "claude-code", scope: ["Bash"], grantedAt: new Date().toISOString() },
    },
  );
  receipt.grantedBashRan = await exists("granted-bash.txt");

  const completed = [receipt.writer, receipt.reviewer, receipt.granted].every(
    (events) => Array.isArray(events) && events.at(-1)?.outcome === "succeeded",
  );
  receipt.allStepsCompleted = completed;
  receipt.version = execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
  receipt.passed =
    completed &&
    receipt.writerEdited &&
    receipt.writerBashDenied &&
    receipt.reviewerWriteDenied &&
    receipt.reviewerBashDenied &&
    receipt.grantedBashRan;
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  receipt.passed = false;
} finally {
  if (local) {
    local.server.closeAllConnections();
    await new Promise<void>((resolveClosed) => local?.server.close(() => resolveClosed()));
  }
  registry.close();
  receipt.finishedAt = new Date().toISOString();
  await writeFile(
    resolve(`docs/evidence/claude-code-native-proof-${new Date().toISOString().slice(0, 10)}.json`),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.passed) process.exitCode = 1;
}
