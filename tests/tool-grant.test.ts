import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decideCommandApproval, dispatchCodexMessage } from "../src/adapters/codex.js";
import { claudeCodeArgs } from "../src/adapters/claude-code.js";
import { kiroChatArgs } from "../src/adapters/kiro.js";
import type { StepExecutionInput } from "../src/adapters/contract.js";
import { parseLoop } from "../src/domain/loop.js";
import {
  formatCommandLine,
  parseCommandLine,
  projectConfigSchema,
  setupCommandSchema,
} from "../src/domain/project.js";
import { createRunRecord, createRunSnapshot } from "../src/domain/run.js";
import {
  describeToolGrant,
  providersNeedingToolGrant,
  toolGrantsSchema,
  type ToolGrantInEffect,
} from "../src/domain/tool-grant.js";
import { initializeProject, projectRevision, saveProjectSetup } from "../src/runtime/project.js";
import { startLocalServer } from "../src/runtime/server.js";
import { resolveToolGrant } from "../src/runtime/tool-grant.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);
const temp = async () => {
  const root = await mkdtemp(join(tmpdir(), "factory-tool-grant-"));
  roots.push(root);
  return root;
};
const kiroGrant: ToolGrantInEffect = {
  provider: "kiro",
  scope: ["execute_bash"],
  grantedAt: "2026-10-07T10:00:00.000Z",
};
const codexGrant: ToolGrantInEffect = {
  provider: "codex",
  scope: ["commandExecution"],
  grantedAt: "2026-10-07T10:00:00.000Z",
};
const claudeGrant: ToolGrantInEffect = {
  provider: "claude-code",
  scope: ["Bash"],
  grantedAt: "2026-10-07T10:00:00.000Z",
};

describe("tool grant schemas and helpers", () => {
  it("accepts only the exact scopes and keeps old configurations valid", () => {
    expect(
      toolGrantsSchema.safeParse({ kiro: { scope: ["*"], grantedAt: kiroGrant.grantedAt } })
        .success,
    ).toBe(false);
    expect(
      toolGrantsSchema.safeParse({
        kiro: { scope: ["execute_bash", "fs_read"], grantedAt: kiroGrant.grantedAt },
      }).success,
    ).toBe(false);
    expect(
      toolGrantsSchema.safeParse({
        cursor: { scope: ["execute_bash"], grantedAt: kiroGrant.grantedAt },
      }).success,
    ).toBe(false);
    expect(
      toolGrantsSchema.safeParse({
        kiro: { scope: ["execute_bash"], grantedAt: kiroGrant.grantedAt, extra: 1 },
      }).success,
    ).toBe(false);
    expect(
      toolGrantsSchema.safeParse({
        "claude-code": { scope: ["Bash"], grantedAt: claudeGrant.grantedAt },
      }).success,
    ).toBe(true);
    expect(
      toolGrantsSchema.safeParse({
        "claude-code": { scope: ["Bash", "WebFetch"], grantedAt: claudeGrant.grantedAt },
      }).success,
    ).toBe(false);
    expect(
      projectConfigSchema.safeParse({ schemaVersion: 1, name: "Old", defaultBinding: null })
        .success,
    ).toBe(true);
  });

  it("lists grantable providers bound to agent steps without a grant", () => {
    const loop = parseLoop({
      schemaVersion: 2,
      id: "mixed",
      name: "Mixed",
      version: 1,
      status: "published",
      steps: [
        {
          id: "a",
          name: "A",
          kind: "agent",
          role: "a",
          instruction: "a",
          binding: { provider: "codex", model: "agent-default" },
        },
        {
          id: "b",
          name: "B",
          kind: "agent",
          role: "b",
          instruction: "b",
          binding: { provider: "kiro", model: "agent-default" },
        },
        {
          id: "c",
          name: "C",
          kind: "check",
          role: "c",
          instruction: "true",
          binding: { provider: "kiro", model: "agent-default" },
        },
        { id: "d", name: "D", kind: "agent", role: "d", instruction: "d" },
      ],
      dependencies: [],
      groups: [],
      joins: [],
      decisions: [],
      policy: { maxAttemptsPerStep: 1 },
    });
    const run = createRunRecord(
      createRunSnapshot(loop, { description: "x" }, { provider: "mock", model: "default" }),
    );
    expect(providersNeedingToolGrant(run, undefined)).toEqual(["kiro", "codex"]);
    expect(
      providersNeedingToolGrant(run, {
        kiro: { scope: ["execute_bash"], grantedAt: kiroGrant.grantedAt },
      }),
    ).toEqual(["codex"]);
  });

  it("describes the permission in effect with the exact evidence text", () => {
    expect(describeToolGrant("kiro", null, "/w")).toBe(
      "Kiro default: trusted tools fs_read, fs_write. Shell (execute_bash) is not trusted.",
    );
    expect(describeToolGrant("codex", codexGrant, "/w")).toBe(
      "Codex project grant from 2026-10-07T10:00:00.000Z: command approval requests are accepted only when the command's working directory is inside /w (an accepted command runs unsandboxed); network-access prompts and file-change approvals are declined.",
    );
    expect(describeToolGrant("codex", null, "/w", "bad file")).toBe(
      "Codex default: command approval requests are declined. Tool permission unavailable: bad file.",
    );
    expect(describeToolGrant("claude-code", null, "/w")).toBe(
      "Claude Code default: file tools allowed. Bash is denied.",
    );
    expect(describeToolGrant("claude-code", claudeGrant, "/w")).toBe(
      "Claude Code project grant from 2026-10-07T10:00:00.000Z: file tools and Bash allowed.",
    );
    expect(describeToolGrant("cursor", null, "/w")).toBe(
      "No tool permission grant applies to provider cursor.",
    );
  });

  it("round-trips setup command lines as argv and validates the schema", () => {
    const argv = ["yarn", "install", "--frozen-lockfile", "a b", "it's"];
    const parsed = parseCommandLine(formatCommandLine(argv));
    expect(parsed).toEqual({ ok: true, argv });
    expect(parseCommandLine("pnpm 'unterminated")).toEqual({
      ok: false,
      error: "Close the quote in the setup command.",
    });
    expect(setupCommandSchema.safeParse("pnpm install").success).toBe(false);
    expect(setupCommandSchema.safeParse([]).success).toBe(false);
    expect(setupCommandSchema.safeParse(["pnpm", "install"]).success).toBe(true);
  });
});

describe("adapter mapping", () => {
  const input = (toolGrant?: ToolGrantInEffect): StepExecutionInput => ({
    runId: crypto.randomUUID(),
    stepId: "review",
    attempt: 1,
    instruction: "Review it",
    binding: { provider: "kiro", model: "claude-x" },
    projectDirectory: "/tmp/work",
    ...(toolGrant ? { toolGrant } : {}),
  });

  it("adds exactly execute_bash to Kiro's trusted tools only with a Kiro grant", () => {
    const base = [
      "chat",
      "--agent-engine",
      "v2",
      "--output-format",
      "stream-json",
      "--no-interactive",
    ];
    expect(kiroChatArgs(input())).toEqual([
      ...base,
      "--trust-tools=fs_read,fs_write",
      "--model",
      "claude-x",
      "Review it",
    ]);
    expect(kiroChatArgs(input(kiroGrant))).toEqual([
      ...base,
      "--trust-tools=fs_read,fs_write,execute_bash",
      "--model",
      "claude-x",
      "Review it",
    ]);
    expect(kiroChatArgs(input(codexGrant))).toContain("--trust-tools=fs_read,fs_write");
    for (const args of [input(), input(kiroGrant)].map(kiroChatArgs)) {
      expect(args).not.toContain("--trust-all-tools");
      expect(args).not.toContain("-a");
    }
  });

  it("allows Bash to Claude Code only with a Claude Code grant", () => {
    const claude = (toolGrant?: ToolGrantInEffect) =>
      claudeCodeArgs({
        ...input(toolGrant),
        binding: { provider: "claude-code", model: "opus", effort: "high" },
      });
    const base = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
      "--permission-prompts",
      "none",
      "--no-session-persistence",
      "--model",
      "opus",
      "--effort",
      "high",
    ];
    expect(claude()).toEqual([...base, "--disallowedTools", "Bash", "--", "Review it"]);
    expect(claude(claudeGrant)).toEqual([...base, "--allowedTools", "Bash", "--", "Review it"]);
    expect(claude(kiroGrant)).toEqual(claude());
    for (const args of [claude(), claude(claudeGrant)]) {
      expect(args).not.toContain("bypassPermissions");
      expect(args).not.toContain("--dangerously-skip-permissions");
    }
  });

  it("denies Claude Code every write tool for a read-only reviewer, even with a grant", () => {
    for (const grant of [undefined, claudeGrant]) {
      const args = claudeCodeArgs({ ...input(grant), readOnly: true });
      expect(args).not.toContain("--allowedTools");
      expect(args.slice(args.indexOf("--disallowedTools"), args.indexOf("--"))).toEqual([
        "--disallowedTools",
        "Bash",
        "Edit",
        "Write",
        "NotebookEdit",
      ]);
    }
  });

  it("trusts only fs_read for a read-only reviewer, even with a Kiro grant", () => {
    for (const grant of [undefined, kiroGrant])
      expect(kiroChatArgs({ ...input(grant), readOnly: true })).toContain("--trust-tools=fs_read");
  });

  it("accepts a Codex command approval only inside the step directory with a Codex grant", async () => {
    const parent = await temp();
    const root = join(parent, "work");
    await mkdir(join(root, "sub"), { recursive: true });
    await mkdir(join(parent, "outside"));
    await symlink(join(parent, "outside"), join(root, "escape"));
    const policy = { grant: codexGrant, root: await realpath(root) };
    const params = (extra: Record<string, unknown>) => ({
      threadId: "t",
      turnId: "u",
      itemId: "i",
      startedAtMs: 1,
      ...extra,
    });
    expect(decideCommandApproval(params({ cwd: root }), undefined)).toBe("decline");
    expect(decideCommandApproval(params({ cwd: root }), { grant: null, root: policy.root })).toBe(
      "decline",
    );
    expect(
      decideCommandApproval(params({ cwd: root }), { grant: kiroGrant, root: policy.root }),
    ).toBe("decline");
    expect(decideCommandApproval(params({ cwd: root }), policy)).toBe("accept");
    expect(decideCommandApproval(params({ cwd: join(root, "sub") }), policy)).toBe("accept");
    expect(decideCommandApproval(params({ cwd: join(parent, "outside") }), policy)).toBe("decline");
    expect(decideCommandApproval(params({ cwd: join(root, "escape") }), policy)).toBe("decline");
    expect(decideCommandApproval(params({ cwd: null }), policy)).toBe("decline");
    expect(decideCommandApproval(params({ cwd: "work" }), policy)).toBe("decline");
    expect(decideCommandApproval(params({ cwd: root, kind: "writeStdin" }), policy)).toBe(
      "decline",
    );
    expect(
      decideCommandApproval(params({ cwd: root, networkApprovalContext: { host: "x" } }), policy),
    ).toBe("decline");
    expect(decideCommandApproval({ turnId: "u", itemId: "i", cwd: root }, policy)).toBe("decline");
  });

  it("replies accept through the dispatch hook, declines when it throws, and keeps file changes declined", () => {
    const sent: unknown[] = [];
    const handlers = (approve: () => boolean) => ({
      response: () => undefined,
      notification: () => undefined,
      send: (message: Record<string, unknown>) => sent.push(message),
      approveCommandExecution: approve,
    });
    dispatchCodexMessage(
      { id: 1, method: "item/commandExecution/requestApproval", params: {} },
      handlers(() => true),
    );
    dispatchCodexMessage(
      { id: 2, method: "item/commandExecution/requestApproval", params: {} },
      handlers(() => {
        throw new Error("boom");
      }),
    );
    dispatchCodexMessage(
      { id: 3, method: "item/fileChange/requestApproval", params: {} },
      handlers(() => true),
    );
    expect(sent).toEqual([
      { jsonrpc: "2.0", id: 1, result: { decision: "accept" } },
      { jsonrpc: "2.0", id: 2, result: { decision: "decline" } },
      { jsonrpc: "2.0", id: 3, result: { decision: "decline" } },
    ]);
  });
});

describe("grant and revoke routes", () => {
  it("persists a grant once, reuses it, preserves it on setup saves, and revokes it", async () => {
    const root = await temp();
    await initializeProject(root);
    const { server, url } = await startLocalServer({ projectDirectory: root, port: 0 });
    const origin = url;
    const call = (
      path: string,
      method: string,
      body: unknown,
      headers: Record<string, string> = { Origin: origin },
    ) =>
      fetch(`${url}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const config = async () =>
      JSON.parse(await readFile(join(root, ".code-factory", "project.json"), "utf8"));
    try {
      const revision = await projectRevision(root);
      expect(
        (
          await call(
            "/api/project/tool-grants",
            "POST",
            { provider: "kiro", revision, acknowledged: true },
            {},
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await call("/api/project/tool-grants", "POST", {
            provider: "kiro",
            revision,
            acknowledged: false,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call("/api/project/tool-grants", "POST", {
            provider: "kiro",
            revision: "stale",
            acknowledged: true,
          })
        ).status,
      ).toBe(409);
      const granted = await call("/api/project/tool-grants", "POST", {
        provider: "kiro",
        revision,
        acknowledged: true,
      });
      expect(granted.status).toBe(200);
      const body = await granted.json();
      expect(body.revision).toBe(await projectRevision(root));
      const stored = (await config()).toolGrants.kiro;
      expect(stored).toEqual({ scope: ["execute_bash"], grantedAt: expect.any(String) });
      const again = await call("/api/project/tool-grants", "POST", {
        provider: "kiro",
        revision: body.revision,
        acknowledged: true,
      });
      expect((await again.json()).project.toolGrants.kiro.grantedAt).toBe(stored.grantedAt);
      const withGrants = await call("/api/project/setup", "PUT", {
        name: "x",
        revision: body.revision,
        toolGrants: {},
      });
      expect(withGrants.status).toBe(400);
      await saveProjectSetup(root, { name: "Renamed", revision: await projectRevision(root) });
      expect((await config()).toolGrants.kiro.grantedAt).toBe(stored.grantedAt);
      expect(
        (await call("/api/project/tool-grants/cursor", "DELETE", { revision: null })).status,
      ).toBe(400);
      const revoked = await call("/api/project/tool-grants/kiro", "DELETE", {
        revision: await projectRevision(root),
      });
      expect(revoked.status).toBe(200);
      expect((await config()).toolGrants).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("refuses a grant before setup is saved and fails closed on a hand-widened scope", async () => {
    const root = await temp();
    const { server, url } = await startLocalServer({ projectDirectory: root, port: 0 });
    try {
      const missing = await fetch(`${url}/api/project/tool-grants`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: url },
        body: JSON.stringify({ provider: "codex", revision: null, acknowledged: true }),
      });
      expect(missing.status).toBe(409);
      expect((await missing.json()).error).toBe(
        "Save project setup before granting tool permission.",
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await initializeProject(root);
    const path = join(root, ".code-factory", "project.json");
    const widened = {
      ...JSON.parse(await readFile(path, "utf8")),
      toolGrants: { kiro: { scope: ["*"], grantedAt: kiroGrant.grantedAt } },
    };
    await writeFile(path, JSON.stringify(widened));
    const resolved = await resolveToolGrant(root, "kiro");
    expect(resolved.grant).toBeNull();
    expect(resolved.note).toMatch(/Invalid project configuration/);
  });
});
