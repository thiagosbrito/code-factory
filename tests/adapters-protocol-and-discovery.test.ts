import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CodexAdapter,
  claimCodexInputRequest,
  createCodexAdapter,
  dispatchCodexMessage,
} from "../src/adapters/codex.js";
import { mockAdapter } from "../src/adapters/mock.js";
import { FixtureRpc, collect, input } from "./support/adapters.js";

describe("portable adapter conformance", () => {
  it("rejects a native input request when only another thread is listening", () => {
    const request = {
      id: 0,
      method: "item/tool/requestUserInput",
      params: { threadId: "ended-thread" },
    };
    const otherThread = (message: Parameters<typeof claimCodexInputRequest>[1]) =>
      message.params?.threadId === "active-thread";
    const replies: Record<string, unknown>[] = [];
    dispatchCodexMessage(request, {
      response: () => {},
      notification: () => {},
      userInputRequest: (message) => claimCodexInputRequest([otherThread], message),
      send: (reply) => replies.push(reply),
    });
    expect(replies).toMatchObject([
      { id: 0, error: { code: -32601, message: expect.stringContaining("requestUserInput") } },
    ]);
    expect(
      claimCodexInputRequest([otherThread], { ...request, params: { threadId: "active-thread" } }),
    ).toBe(true);
  });

  it("declines approval requests and rejects unsupported server requests without consuming response IDs", () => {
    const replies: Record<string, unknown>[] = [];
    const responses: Record<string, unknown>[] = [];
    const notifications: Record<string, unknown>[] = [];
    const handlers = {
      response: (message: Record<string, unknown>) => responses.push(message),
      notification: (message: Record<string, unknown>) => notifications.push(message),
      send: (message: Record<string, unknown>) => replies.push(message),
    };

    dispatchCodexMessage(
      { id: 7, method: "item/commandExecution/requestApproval", params: {} },
      handlers,
    );
    dispatchCodexMessage(
      { id: 8, method: "item/fileChange/requestApproval", params: {} },
      handlers,
    );
    dispatchCodexMessage({ id: 9, method: "unknown/serverRequest", params: {} }, handlers);
    dispatchCodexMessage({ id: 7, method: "item/commandExecution/requestApproval" }, handlers);

    expect(replies).toEqual([
      { jsonrpc: "2.0", id: 7, result: { decision: "decline" } },
      { jsonrpc: "2.0", id: 8, result: { decision: "decline" } },
      {
        jsonrpc: "2.0",
        id: 9,
        error: { code: -32601, message: "Unsupported Codex server request: unknown/serverRequest" },
      },
      { jsonrpc: "2.0", id: 7, result: { decision: "decline" } },
    ]);
    expect(responses).toEqual([]);
    expect(notifications).toEqual([]);
    dispatchCodexMessage({ id: 7, result: { ok: true } }, handlers);
    expect(responses).toEqual([{ id: 7, result: { ok: true } }]);
  });

  it("uses explicit file approval decisions, stays closed on errors, and never approves commands", () => {
    const replies: Record<string, unknown>[] = [];
    const handlers = {
      response: () => {},
      notification: () => {},
      send: (value: Record<string, unknown>) => replies.push(value),
      approveFileChange: () => true,
    };
    dispatchCodexMessage({ id: 1, method: "item/fileChange/requestApproval" }, handlers);
    dispatchCodexMessage({ id: 2, method: "item/commandExecution/requestApproval" }, handlers);
    dispatchCodexMessage(
      { id: 3, method: "item/fileChange/requestApproval" },
      {
        ...handlers,
        approveFileChange: () => {
          throw new Error("No decision");
        },
      },
    );
    expect(replies).toEqual([
      { jsonrpc: "2.0", id: 1, result: { decision: "accept" } },
      { jsonrpc: "2.0", id: 2, result: { decision: "decline" } },
      { jsonrpc: "2.0", id: 3, result: { decision: "decline" } },
    ]);
  });

  it("rejects a spoofed executable before opening the app-server", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factory-executable-"));
    try {
      const executable = join(directory, "codex");
      await writeFile(executable, "#!/bin/sh\necho other-cli 1.2.3\n");
      await chmod(executable, 0o755);
      await expect(createCodexAdapter(executable)).rejects.toThrow(/not a supported Codex CLI/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("inspects a provider without treating catalog entries as entitlement", async () => {
    const rpc = new FixtureRpc();
    const adapter = new CodexAdapter(rpc, "/bin/codex", "0.160.0");
    expect(await adapter.inspect(input.projectDirectory)).toMatchObject({
      authentication: "authenticated",
      authenticationMechanism: "Codex-owned ChatGPT login",
      protocol: "Codex app-server JSON-RPC over stdio",
      capabilities: { waitingInput: "unsupported", pause: "unsupported" },
      models: [{ id: "model-a", displayName: "Model A", efforts: ["low", "high"] }],
    });
    expect(rpc.calls.map((call) => call.method)).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "model/list",
    ]);
    expect(await mockAdapter.inspect(input.projectDirectory)).toMatchObject({
      authentication: "not-required",
      capabilities: {
        steering: "unsupported",
        resume: "unsupported",
        pause: "unsupported",
        waitingInput: "unsupported",
      },
    });
  });

  it("follows model/list cursors so the whole catalog is offered", async () => {
    class PagedRpc extends FixtureRpc {
      override async request(method: string, params: Record<string, unknown>) {
        if (method !== "model/list") return super.request(method, params);
        this.calls.push({ method, params });
        return params.cursor
          ? { data: [{ model: "model-c", displayName: "Model C", hidden: false }] }
          : {
              data: [{ model: "model-b", displayName: "Model B", hidden: false }],
              nextCursor: "page-2",
            };
      }
    }
    const rpc = new PagedRpc();
    const connection = await new CodexAdapter(rpc, "/bin/codex", "0.160.0").inspect("/");
    expect(connection.models?.map((model) => model.id)).toEqual(["model-b", "model-c"]);
    expect(rpc.calls.filter((call) => call.method === "model/list")).toHaveLength(2);
  });

  it("sends catalog-supported effort at turn start and leaves agent default model to Codex", async () => {
    const rpc = new FixtureRpc();
    await collect(new CodexAdapter(rpc, "/bin/codex", "0.160.0"), {
      ...input,
      binding: { provider: "codex", model: "agent-default", effort: "high" },
    });
    expect(rpc.calls.find((call) => call.method === "thread/start")?.params.model).toBeNull();
    expect(rpc.calls.find((call) => call.method === "turn/start")?.params.effort).toBe("high");
    expect(rpc.calls.find((call) => call.method === "turn/start")?.params).not.toHaveProperty(
      "collaborationMode",
    );
  });
});
