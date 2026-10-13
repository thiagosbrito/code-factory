import { removeNodeFixtureDirectory, writeNodeExecutable } from "./support/node-executable.js";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_MODELS,
  ClaudeCodeAdapter,
  createClaudeCodeAdapter,
} from "../src/adapters/claude-code.js";
import type {
  AdapterEvent,
  AgentConnection,
  StepExecutionInput,
} from "../src/adapters/contract.js";
import { ConnectionRegistry } from "../src/runtime/connections.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map(removeNodeFixtureDirectory)));

const catalog = [
  { value: "default", displayName: "Default (recommended)", supportsEffort: true },
  {
    value: "claude-haiku-4-5-20251001",
    displayName: "Haiku 4.5",
    description: "Fastest for quick answers",
  },
  {
    value: "sonnet",
    displayName: "Sonnet 5.5",
    supportedEffortLevels: ["low", "medium", "high"],
  },
];

const signedIn = {
  loggedIn: true,
  authMethod: "claude.ai",
  email: "person@example.com",
  orgName: "Example org",
};

/** A fake `claude` that answers the probes and prints `events` for a print-mode step. */
const fixture = async (
  events: unknown[],
  options: {
    exitCode?: number;
    auth?: unknown;
    authExit?: number;
    catalog?: "fail";
    steer?: boolean;
  } = {},
) => {
  const directory = await mkdtemp(join(tmpdir(), "code-factory-claude-"));
  directories.push(directory);
  const executable = join(directory, "claude");
  const argvFile = join(directory, "argv.json");
  await writeNodeExecutable(
    executable,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.295 (Claude Code)'); process.exit(0); }
if (args.join(' ') === 'auth status --json') { console.log(${JSON.stringify(JSON.stringify(options.auth ?? signedIn))}); process.exit(${options.authExit ?? 0}); }
if (args[0] !== '-p') process.exit(3);
if (args.includes('--permission-mode')) {
  // A step: the instruction (and later guidance) arrive as stream-json user messages on stdin.
  const messages = [];
  const say = (event) => console.log(typeof event === 'string' ? event : JSON.stringify(event));
  const record = () => require('fs').writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify({ args, messages }));
  require('readline').createInterface({ input: process.stdin }).on('line', (line) => {
    messages.push(JSON.parse(line).message.content);
    record();
    if (${JSON.stringify(options.steer === true)}) {
      if (messages.length === 1) say(${JSON.stringify(events[0] ?? null)});
      else {
        say({ type: 'assistant', session_id: 'session-1', message: { content: [{ type: 'text', text: 'Got: ' + messages[1] }] } });
        say(${JSON.stringify(events[1] ?? null)});
        process.exit(0);
      }
      return;
    }
    for (const event of ${JSON.stringify(events)}) say(event);
    process.exit(${options.exitCode ?? 0});
  });
} else if (args.includes('--input-format')) {
  require('readline').createInterface({ input: process.stdin }).on('line', (line) => {
    const request = JSON.parse(line);
    if (${JSON.stringify(options.catalog === "fail")}) process.exit(1);
    console.log(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response: { account: { email: 'person@example.com' }, models: ${JSON.stringify(catalog)} } } }));
  });
} else {
  process.exit(3);
}
`,
  );
  return { directory, executable, argvFile };
};

const input = (directory: string): StepExecutionInput => ({
  runId: "run-1",
  stepId: "step-1",
  attempt: 1,
  instruction: "Write the change",
  binding: { provider: "claude-code", model: "agent-default" },
  projectDirectory: directory,
});
const collect = async (adapter: ClaudeCodeAdapter, stepInput: StepExecutionInput) => {
  const events: AdapterEvent[] = [];
  for await (const event of adapter.execute(stepInput, new AbortController().signal))
    events.push(event);
  return events;
};
const init = { type: "system", subtype: "init", session_id: "session-1", model: "x" };
const result = (text: string, isError = false) => ({
  type: "result",
  subtype: isError ? "error_during_execution" : "success",
  is_error: isError,
  session_id: "session-1",
  result: text,
});
const candidate = (executable: string): AgentConnection => ({
  provider: "claude-code",
  executable,
  installation: "detected",
  authentication: "unknown",
  capabilities: {
    streaming: "unknown",
    steering: "unknown",
    resume: "unknown",
    pause: "unknown",
    waitingInput: "unknown",
  },
});

describe("Claude Code connection", () => {
  it("connects a detected CLI and never copies the account email or organization", async () => {
    const { directory, executable } = await fixture([]);
    const registry = new ConnectionRegistry(directory, async () => [candidate(executable)]);
    try {
      expect((await registry.list())[0]?.reason).toBeUndefined();
      const connection = await registry.connect({ provider: "claude-code", launch: true });
      expect(connection).toMatchObject({
        provider: "claude-code",
        authentication: "authenticated",
        authenticationMechanism: "Claude Code login (claude.ai)",
        identity: "Claude Code",
        version: "2.1.295",
        protocol: "claude-code-stream-json",
        capabilities: { streaming: "supported", steering: "supported", resume: "unsupported" },
        models: [
          {
            id: "claude-haiku-4-5-20251001",
            displayName: "Haiku 4.5",
            description: "Fastest for quick answers",
            efforts: [],
          },
          { id: "sonnet", displayName: "Sonnet 5.5", efforts: ["low", "medium", "high"] },
        ],
        customModels: { efforts: ["low", "medium", "high", "xhigh", "max"] },
      });
      expect(JSON.stringify(connection)).not.toMatch(/person@example\.com|Example org/);
      expect(registry.adapter("claude-code")?.provider).toBe("claude-code");
    } finally {
      registry.close();
    }
  });

  it("falls back to the documented aliases when the CLI cannot list its models", async () => {
    const { executable } = await fixture([], { catalog: "fail" });
    const connection = await (await createClaudeCodeAdapter(executable)).inspect("/");
    expect(connection.models).toEqual(CLAUDE_CODE_MODELS);
  });

  it("reports a signed-out CLI as unauthenticated even when it exits nonzero", async () => {
    const { executable } = await fixture([], { auth: { loggedIn: false }, authExit: 1 });
    const adapter = await createClaudeCodeAdapter(executable);
    expect((await adapter.inspect("/")).authentication).toBe("unauthenticated");
  });

  it("rejects an executable that is not Claude Code or prints no status", async () => {
    const { directory, executable } = await fixture([], { auth: "not json" });
    await expect((await createClaudeCodeAdapter(executable)).inspect(directory)).rejects.toThrow(
      "did not print an authentication status",
    );
    const other = join(directory, "other");
    await writeNodeExecutable(other, "#!/usr/bin/env node\nconsole.log('codex-cli 0.160.0');\n");

    await expect(createClaudeCodeAdapter(other)).rejects.toThrow("not a supported Claude Code CLI");
  });
});

describe("Claude Code stream adapter", () => {
  it("translates the print-mode stream into the shared step contract", async () => {
    const { directory, executable, argvFile } = await fixture([
      init,
      { type: "system", subtype: "commands_changed", session_id: "session-1" },
      { type: "rate_limit_event", session_id: "session-1" },
      {
        type: "assistant",
        session_id: "session-1",
        message: {
          content: [
            { type: "thinking", thinking: "" },
            { type: "text", text: "Reading first." },
            { type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/a.ts" } },
            { type: "tool_use", id: "t2", name: "Bash", input: { command: "ls" } },
          ],
        },
      },
      {
        type: "user",
        session_id: "session-1",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "1\thello" },
            { type: "tool_result", tool_use_id: "t2", is_error: true, content: "denied" },
          ],
        },
      },
      {
        type: "assistant",
        session_id: "session-1",
        message: { content: [{ type: "text", text: "pass" }] },
      },
      result("pass\nAll checks hold."),
    ]);
    const adapter = new ClaudeCodeAdapter(executable, "2.1.295");
    const events = await collect(adapter, {
      ...input(directory),
      binding: { provider: "claude-code", model: "sonnet", effort: "low" },
    });
    expect(events.map((event) => event.type)).toEqual([
      "started",
      "message",
      "tool",
      "tool",
      "tool",
      "tool",
      "message",
      "completed",
    ]);
    expect(new Set(events.map((event) => event.sessionId))).toEqual(new Set(["session-1"]));
    expect(events.filter((event) => event.type === "tool")).toMatchObject([
      { title: "Read", detail: "src/a.ts", state: "started" },
      { title: "Bash", detail: "ls", state: "started" },
      { title: "Read", state: "completed" },
      { title: "Bash", state: "failed" },
    ]);
    expect(events.at(-1)).toMatchObject({ outcome: "succeeded", output: "pass\nAll checks hold." });
    const sent = JSON.parse(await readFile(argvFile, "utf8")) as {
      args: string[];
      messages: string[];
    };
    expect(sent.args).toEqual(
      expect.arrayContaining([
        "--model",
        "sonnet",
        "--effort",
        "low",
        "--input-format",
        "stream-json",
      ]),
    );
    // The instruction travels as a stdin message, never on the command line.
    expect(sent.args).not.toContain("Write the change");
    expect(sent.messages).toEqual(["Write the change"]);
  });

  it("declares steering supported and delivers guidance into the running step", async () => {
    const { directory, executable, argvFile } = await fixture([init, result("pass\nGuided.")], {
      steer: true,
    });
    const adapter = new ClaudeCodeAdapter(executable, "2.1.295");
    expect(adapter.capabilities.steering).toBe("supported");
    const events: AdapterEvent[] = [];
    let steered: string | undefined;
    for await (const event of adapter.execute(input(directory), new AbortController().signal)) {
      events.push(event);
      if (event.type === "started")
        steered = await adapter.steer(event, "Check the accessible name.");
    }
    expect(steered).toBe("supported");
    expect(events.filter((event) => event.type === "message")).toMatchObject([
      { text: "Got: Check the accessible name." },
    ]);
    expect(events.at(-1)).toMatchObject({ outcome: "succeeded", output: "pass\nGuided." });
    const sent = JSON.parse(await readFile(argvFile, "utf8")) as { messages: string[] };
    expect(sent.messages).toEqual(["Write the change", "Check the accessible name."]);
  });

  it("refuses guidance for a step that has finished", async () => {
    const { directory, executable } = await fixture([init, result("done")]);
    const adapter = new ClaudeCodeAdapter(executable, "2.1.295");
    let session: Extract<AdapterEvent, { type: "started" }> | undefined;
    for await (const event of adapter.execute(input(directory), new AbortController().signal))
      if (event.type === "started") session = event;
    if (!session) throw new Error("the step never started");
    await expect(adapter.steer(session, "too late")).rejects.toThrow("no longer taking guidance");
  });

  it("completes a failed result as a failed step even when the CLI exits nonzero", async () => {
    const { directory, executable } = await fixture([init, result("Max turns reached", true)], {
      exitCode: 1,
    });
    const events = await collect(new ClaudeCodeAdapter(executable, "2.1.295"), input(directory));
    expect(events.at(-1)).toMatchObject({ outcome: "failed", output: "Max turns reached" });
  });

  it("does not report success when the process fails after a success result", async () => {
    const { directory, executable } = await fixture([init, result("done")], { exitCode: 2 });
    await expect(
      collect(new ClaudeCodeAdapter(executable, "2.1.295"), input(directory)),
    ).rejects.toThrow("without successful completion (2)");
  });

  it("rejects malformed lines, a missing init event and a session mismatch", async () => {
    for (const [events, message] of [
      [[init, "not json"], "Invalid Claude Code stream event"],
      [[result("done")], "did not start with an init event"],
      [[init, { ...result("done"), session_id: "other" }], "session mismatch"],
      [[init, result("a"), result("b")], "Duplicate Claude Code result event"],
    ] as const) {
      const { directory, executable } = await fixture([...events]);
      await expect(
        collect(new ClaudeCodeAdapter(executable, "2.1.295"), input(directory)),
      ).rejects.toThrow(message);
    }
  });

  it("terminates the process group when the connection is closed", async () => {
    const { directory, executable } = await fixture([]);
    const pidFile = join(directory, "child.pid");
    await writeNodeExecutable(
      executable,
      `#!/usr/bin/env node\nconst nested = require('child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'inherit'});\nrequire('fs').writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid,nested.pid]));\nconsole.log(JSON.stringify(${JSON.stringify(init)}));\nsetInterval(()=>{},1000);\n`,
    );
    const adapter = new ClaudeCodeAdapter(executable, "2.1.295");
    const events = adapter
      .execute(input(directory), new AbortController().signal)
      [Symbol.asyncIterator]();
    expect((await events.next()).value?.type).toBe("started");
    const pids = JSON.parse(await readFile(pidFile, "utf8")) as number[];
    adapter.close();
    await expect(events.next()).rejects.toThrow("without successful completion");
    for (const pid of pids)
      await expect
        .poll(() => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        })
        .toBe(false);
  });
});
