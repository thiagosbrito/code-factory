import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { auditUsage, readSession } from "../scripts/symphony/usage.mjs";

test("usage audit deduplicates cumulative snapshots and never exposes session text", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "symphony-usage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sessions = join(root, "sessions"),
    workspace = join(root, "workspaces"),
    ticket = join(workspace, "THI-ABC123");
  mkdirSync(sessions);
  mkdirSync(ticket, { recursive: true });
  const path = join(sessions, "session.jsonl");
  const events = [
    { type: "session_meta", payload: { cwd: ticket } },
    { type: "user_message", payload: { text: "secret prompt must stay private" } },
    { type: "turn_context", payload: { model: "test-model", prompt: "secret context text" } },
    {
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 10,
            output_tokens: 20,
            reasoning_output_tokens: 7,
          },
          last_token_usage: { input_tokens: 100, cached_input_tokens: 10, output_tokens: 20 },
        },
      },
    },
    {
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 10,
            output_tokens: 20,
            reasoning_output_tokens: 7,
          },
          last_token_usage: { input_tokens: 100, cached_input_tokens: 10, output_tokens: 20 },
        },
      },
    },
    {
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 150,
            cached_input_tokens: 20,
            output_tokens: 25,
            reasoning_output_tokens: 9,
          },
          last_token_usage: { input_tokens: 40, cached_input_tokens: 5, output_tokens: 8 },
        },
      },
    },
  ];
  writeFileSync(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const session = await readSession(path, workspace);
  assert.equal(session.ticket, "THI-ABC123");
  assert.equal(session.calls, 2);
  assert.equal(session.inputTokens, 150);
  assert.equal(session.cachedInputTokens, 20);
  assert.equal(session.freshInputTokens, 130);
  assert.equal(session.outputTokens, 25);
  assert.equal(session.peakContextTokens, 120);
  assert.equal(session.currentContextTokens, 48);
  const audit = await auditUsage({ sessionsDir: sessions, workspaceRoot: workspace });
  assert.equal(audit.tickets.length, 1);
  assert.equal(audit.tickets[0].models["test-model"], 2);
  assert.doesNotMatch(JSON.stringify(audit), /secret (prompt|context)/);
});

test("flat events, stale snapshots, zero initialization and context use request metadata", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "symphony-usage-events-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "events.jsonl");
  const count = (input, output, last) => ({
    type: "token_count",
    payload: {
      info: {
        total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: output },
        last_token_usage: last,
      },
    },
  });
  writeFileSync(
    file,
    [
      { type: "session_meta", payload: { cwd: join(root, "workspaces", "THI-1") } },
      { type: "turn_context", payload: { model: "gpt-6-sol" } },
      count(0, 0, { input_tokens: 0, output_tokens: 0 }),
      count(100, 10, { input_tokens: 100, output_tokens: 10 }),
      count(200, 20, { input_tokens: 100, output_tokens: 10 }),
      count(100, 10, { input_tokens: 100, output_tokens: 10 }),
      count(200, 20, { input_tokens: 100, output_tokens: 10 }),
    ]
      .map((x) => JSON.stringify(x))
      .join("\n"),
  );
  const usage = await readSession(file, join(root, "workspaces"));
  assert.equal(usage.calls, 2);
  assert.equal(usage.model, "gpt-6-sol");
  assert.equal(usage.inputTokens, 200);
  assert.equal(usage.currentContextTokens, 110);
  const foreign = await readSession(file, join(root, "work"));
  assert.equal(foreign.ticket, null);
  assert.equal(foreign.calls, 0);
});
