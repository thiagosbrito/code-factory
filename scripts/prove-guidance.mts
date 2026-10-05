import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAdapter, CodexStdioRpc, type CodexRpc } from "../src/adapters/codex.js";
import { parseLoop } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot } from "../src/domain/run.js";
import { ConnectionRegistry } from "../src/runtime/connections.js";
import { startLocalServer } from "../src/runtime/server.js";
import { createRun, readRun } from "../src/runtime/storage.js";

const executable = process.env.CODEX_EXECUTABLE ?? "codex";
const version = execFileSync(executable, ["--version"], { encoding: "utf8" }).trim();
if (version !== "codex-cli 0.160.0") throw new Error(`Unverified Codex version: ${version}`);
const project = await mkdtemp(join(tmpdir(), "factory-guidance-native-"));
const workspace = join(project, ".code-factory", "workspaces", "candidate");
await mkdir(workspace, { recursive: true });
await writeFile(join(workspace, "baseline.txt"), "disposable native guidance proof\n");
const methods: { method: string; ok: boolean }[] = [];
const native = new CodexStdioRpc(executable);
const traced: CodexRpc = {
  request: async (method, params) => {
    try {
      const result = await native.request(method, params);
      methods.push({ method, ok: true });
      return result;
    } catch (error) {
      methods.push({ method, ok: false });
      throw error;
    }
  },
  notify: (method, params) => native.notify(method, params),
  subscribe: (listener) => native.subscribe(listener),
  close: () => native.close(),
};
const adapter = new CodexAdapter(traced, executable, "0.160.0");
let server: Awaited<ReturnType<typeof startLocalServer>>["server"] | undefined;
const receipt: Record<string, unknown> = { version, model: "gpt-6-luna", methods };
const waitFor = async <T,>(read: () => Promise<T | undefined>, label: string): Promise<T> => {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
};
try {
  const connection = await adapter.inspect(project);
  if (
    connection.authentication !== "authenticated" ||
    adapter.capabilities.steering !== "supported"
  )
    throw new Error("Codex steering connection is not verified.");
  const loop = parseLoop({
    schemaVersion: 2,
    id: "guidance-proof",
    name: "Native guidance proof",
    version: 1,
    status: "published",
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
    policy: { maxAttemptsPerStep: 1, maxImplementationRounds: 1 },
    steps: [
      {
        id: "agent",
        name: "Disposable agent",
        kind: "agent",
        stage: "implementation",
        role: "builder",
        instruction:
          "This is a disposable local guidance proof. Run the safe shell command `sleep 8` in this project before replying. Follow any live guidance received during the turn. Do not inspect other directories or use the network.",
      },
    ],
  });
  const run = createRunRecord(
    createRunSnapshot(
      loop,
      { description: "Prove persisted HTTP guidance in a disposable project." },
      { provider: "codex", model: "gpt-6-luna", effort: "low" },
      {
        id: "disposable-baseline",
        kind: "git",
        revision: "disposable",
        workspace: ".code-factory/workspaces/candidate",
        capturedAt: new Date().toISOString(),
      },
    ),
  );
  await createRun(project, run);
  const connections = {
    adapter: (provider: string) => (provider === "codex" ? adapter : null),
    list: async () => [connection],
    close: () => adapter.close(),
  } as unknown as ConnectionRegistry;
  const local = await startLocalServer({ projectDirectory: project, port: 0, connections });
  server = local.server;
  const launch = await fetch(`${local.url}/api/runs/${run.snapshot.id}/execute`, {
    method: "POST",
  });
  if (launch.status !== 202) throw new Error(`Execution returned ${launch.status}`);
  const attemptId = await waitFor(async () => {
    const current = await readRun(project, run.snapshot.id);
    const attempt = current?.steps[0]?.attempts[0];
    return attempt?.sessionId && attempt.turnId && attempt.status === "running"
      ? attempt.id
      : undefined;
  }, "native session identity");
  const sent = await fetch(`${local.url}/api/runs/${run.snapshot.id}/guidance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stepId: "agent",
      attemptId,
      message: "In your final reply include the exact marker guidance-applied.",
    }),
  });
  receipt.guidanceHttpStatus = sent.status;
  if (sent.status !== 200)
    throw new Error(`Guidance returned ${sent.status}: ${await sent.text()}`);
  const finished = await waitFor(async () => {
    const current = await readRun(project, run.snapshot.id);
    return current && current.status !== "pending" && current.status !== "running"
      ? current
      : undefined;
  }, "native run completion");
  const guidance = finished.evidence.filter((item) => item.kind === "guidance");
  const events = finished.evidence.filter((item) => item.kind === "event");
  receipt.runStatus = finished.status;
  receipt.attempts = finished.steps[0]?.attempts.length;
  receipt.guidanceStates = guidance.map((item) => item.state);
  receipt.acknowledgedReplyEventId =
    guidance.find((item) => item.state === "acknowledged")?.replyEventId ?? null;
  receipt.completionText =
    [...events]
      .reverse()
      .find((item) => item.title === "completed")
      ?.detail?.slice(0, 800) ?? null;
  receipt.eventCounts = Object.fromEntries(
    [...new Set(events.map((item) => item.type))].map((type) => [
      type,
      events.filter((item) => item.type === type).length,
    ]),
  );
  receipt.noInterrupt = !methods.some((item) => item.method === "turn/interrupt");
  receipt.passed =
    finished.status === "succeeded" &&
    guidance.some((item) => item.state === "queued") &&
    guidance.some((item) => item.state === "delivered") &&
    guidance.some((item) => item.state === "acknowledged") &&
    Boolean(receipt.acknowledgedReplyEventId) &&
    receipt.noInterrupt === true &&
    receipt.attempts === 1;
  if (!receipt.passed) throw new Error("Native guidance acceptance checks failed.");
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
} finally {
  receipt.finishedAt = new Date().toISOString();
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  adapter.close();
  await rm(project, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (!receipt.passed) process.exitCode = 1;
}
