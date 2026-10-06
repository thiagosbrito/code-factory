import { chmod, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KiroAdapter, createKiroAdapter } from "../src/adapters/kiro.js";
import type {
  AdapterEvent,
  AgentConnection,
  StepExecutionInput,
  StepSession,
} from "../src/adapters/contract.js";
import { ConnectionRegistry } from "../src/runtime/connections.js";

const fixture = async (events: unknown[], exitCode = 0) => {
  const directory = await mkdtemp(join(tmpdir(), "code-factory-kiro-"));
  const executable = join(directory, "kiro-cli");
  const script = `#!/usr/bin/env node
if (process.argv[2] === '--version') { console.log('kiro-cli 2.27.1'); process.exit(0); }
if (process.argv[2] === 'whoami') { console.log('{"accountType":"Fixture"}\\n\\nProfile: fixture'); process.exit(0); }
if (process.argv[3] === '--list-models') { console.log('{"models":[{"model_id":"fixture-model","model_name":"Fixture model"}]}'); process.exit(0); }
if (process.argv.slice(2, 9).join('|') !== 'chat|--agent-engine|v2|--output-format|stream-json|--no-interactive|--trust-tools=fs_read,fs_write') process.exit(3);
if (process.argv.includes('--model') && process.argv[10] !== 'fixture-model') process.exit(4);
for (const event of ${JSON.stringify(events)}) console.log(JSON.stringify(event));
process.exit(${exitCode});
`;
  await writeFile(executable, script);
  await chmod(executable, 0o755);
  return { directory, executable };
};

const input = (directory: string): StepExecutionInput => ({
  runId: "run-1",
  stepId: "step-1",
  attempt: 1,
  instruction: "Write the change",
  binding: { provider: "kiro", model: "agent-default" },
  projectDirectory: directory,
});

describe("Kiro v2 stream adapter", () => {
  it("terminates active native children when the connection is closed", async () => {
    const { directory, executable } = await fixture([]);
    try {
      const pidFile = join(directory, "child.pid");
      await writeFile(
        executable,
        `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nconsole.log(JSON.stringify({type:'metadata',data:{sessionId:'active'}}));\nsetInterval(()=>{},1000);\n`,
      );
      const adapter = new KiroAdapter(executable, "2.27.1");
      const events = adapter
        .execute(input(directory), new AbortController().signal)
        [Symbol.asyncIterator]();
      expect((await events.next()).value?.type).toBe("started");
      const pid = Number(await readFile(pidFile, "utf8"));
      adapter.close();
      await expect(events.next()).rejects.toThrow("without successful completion");
      expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
      expect(adapter.capabilities.resume).toBe("unsupported");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects effort selections whose support is not advertised", async () => {
    const adapter = new KiroAdapter("/not-launched", "2.27.1");
    await expect(async () => {
      for await (const _event of adapter.execute(
        { ...input("/tmp"), binding: { provider: "kiro", model: "agent-default", effort: "high" } },
        new AbortController().signal,
      )) {
        /* consume */
      }
    }).rejects.toThrow("does not advertise supported effort choices");
  });

  it("connects an explicitly selected detected Kiro CLI through the shared registry", async () => {
    const { directory, executable } = await fixture([]);
    try {
      const candidate: AgentConnection = {
        provider: "kiro",
        executable,
        installation: "detected",
        authentication: "unknown",
        capabilities: { streaming: "unknown", steering: "unknown", resume: "unknown" },
      };
      const registry = new ConnectionRegistry(directory, async () => [candidate]);
      expect((await registry.list())[0]?.authentication).toBe("unknown");
      const connection = await registry.connect({ provider: "kiro", launch: true });
      expect(connection).toMatchObject({
        provider: "kiro",
        authentication: "authenticated",
        capabilities: { streaming: "supported", steering: "unsupported", resume: "unsupported" },
      });
      expect(registry.adapter("kiro")?.provider).toBe("kiro");
      expect((await registry.list())[0]?.authentication).toBe("authenticated");
      registry.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("verifies identity and translates the native stream into the shared step contract", async () => {
    const events = [
      { type: "runStarted", data: { payloadSchema: "acp", acpProtocolVersion: 1, engine: "v2" } },
      { type: "metadata", data: { sessionId: "native-1" } },
      {
        type: "sessionUpdate",
        data: {
          sessionId: "native-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "I will inspect the file." },
          },
        },
      },
      {
        type: "sessionUpdate",
        data: {
          sessionId: "native-1",
          update: {
            sessionUpdate: "tool_call",
            title: "Creating proof.txt",
            content: [{ type: "diff", path: "proof.txt" }],
          },
        },
      },
      {
        type: "sessionUpdate",
        data: {
          sessionId: "native-1",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } },
        },
      },
      { type: "metadata", data: { sessionId: "native-1" } },
      {
        type: "runFinished",
        data: {
          sessionId: "native-1",
          status: "success",
          finalText: "I will inspect the file.done",
        },
      },
    ];
    const { directory, executable } = await fixture(events);
    try {
      const adapter = await createKiroAdapter(executable);
      const connection = await adapter.inspect(directory);
      expect(connection).toMatchObject({
        provider: "kiro",
        version: "2.27.1",
        authentication: "authenticated",
        protocol: "kiro-v2-stream-json",
        models: [{ id: "fixture-model", displayName: "Fixture model" }],
      });
      const result: AdapterEvent[] = [];
      for await (const event of adapter.execute(
        { ...input(directory), binding: { provider: "kiro", model: "fixture-model" } },
        new AbortController().signal,
      ))
        result.push(event);
      expect(result.map((event) => event.type)).toEqual([
        "started",
        "message",
        "tool",
        "message",
        "completed",
      ]);
      expect(result[0]).toMatchObject({ sessionId: "native-1", runId: "run-1", stepId: "step-1" });
      expect(result[4]).toMatchObject({ outcome: "succeeded", output: "done" });
      const session = result[0] as StepSession;
      expect(await adapter.steer(session, "change course")).toBe("unsupported");
      await expect(async () => {
        for await (const _event of adapter.attach(session, new AbortController().signal)) {
          /* no events */
        }
      }).rejects.toThrow("cannot be resumed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a stream with mismatched native session identity", async () => {
    const { directory, executable } = await fixture([
      { type: "runStarted", data: { payloadSchema: "acp", acpProtocolVersion: 1 } },
      { type: "metadata", data: { sessionId: "native-1" } },
      { type: "runFinished", data: { sessionId: "other", status: "success" } },
    ]);
    try {
      const adapter = new KiroAdapter(executable, "2.27.1");
      await expect(async () => {
        for await (const _event of adapter.execute(
          input(directory),
          new AbortController().signal,
        )) {
          /* consume */
        }
      }).rejects.toThrow("session mismatch");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not report success when the native process fails after runFinished", async () => {
    const { directory, executable } = await fixture(
      [
        { type: "runStarted", data: { payloadSchema: "acp", acpProtocolVersion: 1 } },
        { type: "metadata", data: { sessionId: "native-1" } },
        { type: "runFinished", data: { sessionId: "native-1", status: "success" } },
      ],
      7,
    );
    try {
      const adapter = new KiroAdapter(executable, "2.27.1");
      const events: AdapterEvent[] = [];
      await expect(async () => {
        for await (const event of adapter.execute(input(directory), new AbortController().signal))
          events.push(event);
      }).rejects.toThrow("without successful completion (7)");
      expect(events.map((event) => event.type)).toEqual(["started"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
