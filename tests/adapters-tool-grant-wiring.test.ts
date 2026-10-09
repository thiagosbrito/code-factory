import { describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAdapter, createCodexAdapter } from "../src/adapters/codex.js";
import { z } from "zod";
import { collect, input } from "./support/adapters.js";

/**
 * A stand-in `codex` executable speaking app-server JSON-RPC over stdio. Each turn sends three
 * command approvals (cwd inside the step directory, cwd outside it, and inside with a network
 * prompt) and completes once all are answered. Starting a second thread first sends a late
 * approval for the previous thread, whose turn has ended. Every reply is appended to `log`.
 */
const fakeCodexServer = (log: string, inside: string, outside: string) => `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const { createInterface } = require("node:readline");
if (process.argv.includes("--version")) {
  console.log("codex-cli 0.160.0");
  process.exit(0);
}
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const open = new Map();
let threads = 0;
let previous = null;
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === undefined && message.id !== undefined) {
    appendFileSync(${JSON.stringify(log)}, JSON.stringify({ id: message.id, decision: message.result?.decision }) + "\\n");
    for (const [turnId, turn] of open) {
      turn.pending.delete(message.id);
      if (turn.pending.size === 0) {
        open.delete(turnId);
        send({ method: "turn/completed", params: { threadId: turn.threadId, turn: { id: turnId, status: "completed" } } });
      }
    }
    return;
  }
  if (message.id === undefined) return;
  const approve = (id, threadId, turnId, params) =>
    send({ id, method: "item/commandExecution/requestApproval", params: { threadId, turnId, itemId: id, command: "pnpm test", ...params } });
  if (message.method === "initialize") return send({ id: message.id, result: { userAgent: "fake" } });
  if (message.method === "thread/start") {
    if (previous) approve(previous.threadId + "-after-turn", previous.threadId, previous.turnId, { cwd: ${JSON.stringify(inside)} });
    return send({ id: message.id, result: { thread: { id: "thread-" + ++threads } } });
  }
  if (message.method === "turn/start") {
    const threadId = message.params.threadId;
    const turnId = "turn-" + threadId;
    previous = { threadId, turnId };
    send({ id: message.id, result: { turn: { id: turnId } } });
    const requests = [
      [threadId + "-inside", { cwd: ${JSON.stringify(inside)} }],
      [threadId + "-outside", { cwd: ${JSON.stringify(outside)} }],
      [threadId + "-network", { cwd: ${JSON.stringify(inside)}, networkApprovalContext: { host: "example.com" } }],
    ];
    open.set(turnId, { threadId, pending: new Set(requests.map(([id]) => id)) });
    for (const [id, params] of requests) approve(id, threadId, turnId, params);
    return;
  }
  send({ id: message.id, result: {} });
});
`;

describe("Codex adapter tool grant wiring", () => {
  it("accepts command approvals inside the step directory only for a granted, active thread", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factory-codex-grant-"));
    const adapters: CodexAdapter[] = [];
    try {
      const project = join(directory, "project");
      const outside = join(directory, "outside");
      await mkdir(join(project, "src"), { recursive: true });
      await mkdir(outside);
      const log = join(directory, "replies.jsonl");
      const executable = join(directory, "codex");
      await writeFile(executable, fakeCodexServer(log, join(project, "src"), outside));
      await chmod(executable, 0o755);
      // createCodexAdapter wires the stdio RPC's approval hook to the adapter's thread policies.
      const adapter = await createCodexAdapter(executable);
      adapters.push(adapter);
      const step = { ...input, projectDirectory: project };
      const granted = await collect(adapter, {
        ...step,
        toolGrant: {
          provider: "codex",
          scope: ["commandExecution"],
          grantedAt: "2026-10-07T10:00:00.000Z",
        },
      });
      expect(granted.at(-1)).toMatchObject({ type: "completed", sessionId: "thread-1" });
      const ungranted = await collect(adapter, { ...step, attempt: 2 });
      expect(ungranted.at(-1)).toMatchObject({ type: "completed", sessionId: "thread-2" });
      const replies = Object.fromEntries(
        (await readFile(log, "utf8"))
          .trim()
          .split("\n")
          .map((line) => {
            const reply = z
              .object({ id: z.string(), decision: z.string() })
              .parse(JSON.parse(line));
            return [reply.id, reply.decision];
          }),
      );
      expect(replies).toEqual({
        "thread-1-inside": "accept",
        "thread-1-outside": "decline",
        "thread-1-network": "decline",
        // The granted thread's turn has ended, so its policy is gone.
        "thread-1-after-turn": "decline",
        "thread-2-inside": "decline",
        "thread-2-outside": "decline",
        "thread-2-network": "decline",
      });
    } finally {
      for (const adapter of adapters) adapter.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
