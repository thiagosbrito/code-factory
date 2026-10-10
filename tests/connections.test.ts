import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentConnection } from "../src/adapters/contract.js";
import { ConnectionRegistry } from "../src/runtime/connections.js";
import { startLocalServer } from "../src/runtime/server.js";
import { userConnectionMemory } from "../src/runtime/connection-memory.js";
import { trustDirectory, trustProject } from "../src/runtime/trust.js";
import { readProjectConfig } from "../src/runtime/project.js";
import { createLoopDraft, parseLoop } from "../src/domain/loop.js";
import { createRunSnapshot } from "../src/domain/run.js";

const directories: string[] = [];
async function temporaryProject() {
  const directory = await mkdtemp(join(tmpdir(), "factory-connections-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
function detected(executable: string): AgentConnection[] {
  return [
    {
      provider: "codex",
      executable,
      installation: "detected",
      authentication: "unknown",
      capabilities: {
        streaming: "unknown",
        steering: "unknown",
        resume: "unknown",
        pause: "unsupported",
        waitingInput: "unknown",
      },
    },
    {
      provider: "cursor",
      executable: "/bin/cursor-agent",
      installation: "detected",
      authentication: "unknown",
      capabilities: {
        streaming: "unknown",
        steering: "unknown",
        resume: "unknown",
        pause: "unsupported",
        waitingInput: "unknown",
      },
    },
    {
      provider: "custom",
      executable: null,
      installation: "missing",
      authentication: "unknown",
      capabilities: {
        streaming: "unknown",
        steering: "unknown",
        resume: "unknown",
        pause: "unsupported",
        waitingInput: "unknown",
      },
    },
  ];
}
function inspected(
  executable: string,
  models = ["model-a"],
  authenticated = true,
): AgentConnection {
  return {
    provider: "codex",
    executable,
    installation: "detected",
    identity: "Codex CLI",
    version: "0.160.0",
    protocol: "Codex app-server JSON-RPC over stdio",
    authentication: authenticated ? "authenticated" : "unauthenticated",
    authenticationMechanism: "Codex-owned ChatGPT login",
    capabilities: {
      streaming: "unknown",
      steering: "unknown",
      resume: "unknown",
      pause: "unsupported",
      waitingInput: "unknown",
    },
    models: models.map((id) => ({ id, displayName: id, efforts: ["low", "high"] })),
  };
}

describe("connection registry and local handoff", () => {
  it("keeps discovery separate from launch, reports unsupported providers, and rechecks the catalog", async () => {
    const directory = await temporaryProject();
    let launches = 0;
    let authenticated = false;
    let models = ["model-a"];
    const registry = new ConnectionRegistry(
      directory,
      async () => detected("/bin/codex"),
      async (executable) => {
        launches++;
        return {
          inspect: async () => inspected(executable, models, authenticated),
          close: () => {},
        };
      },
    );
    const { server, url } = await startLocalServer({
      sessionToken: null,
      projectDirectory: directory,
      port: 0,
      connections: registry,
    });
    try {
      const listed = (await fetch(`${url}/api/agents`).then((response) => response.json())) as {
        agents: AgentConnection[];
      };
      expect(launches).toBe(0);
      expect(listed.agents.find((item) => item.provider === "codex")?.authentication).toBe(
        "unknown",
      );
      expect(listed.agents.find((item) => item.provider === "cursor")?.reason).toMatch(
        /not implemented/,
      );
      const connect = () =>
        fetch(`${url}/api/agents/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "codex", launch: true }),
        });
      const first = (await (await connect()).json()) as { connection: AgentConnection };
      expect(first.connection.authentication).toBe("unauthenticated");
      expect(first.connection.version).toBe("0.160.0");
      const premature = await fetch(`${url}/api/project/setup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Demo",
          revision: null,
          defaultBinding: { provider: "codex", model: "model-a" },
        }),
      });
      expect(premature.status).toBe(422);
      authenticated = true;
      models = ["model-b"];
      const second = (await (await connect()).json()) as { connection: AgentConnection };
      expect(launches).toBe(2);
      expect(second.connection.models?.map((item) => item.id)).toEqual(["model-b"]);
      const stale = await fetch(`${url}/api/project/setup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Demo",
          revision: null,
          defaultBinding: { provider: "codex", model: "model-a" },
        }),
      });
      expect(stale.status).toBe(422);
      expect(((await stale.json()) as { error: string }).error).toMatch(/unavailable/);
    } finally {
      server.close();
    }
  });

  it("requires an explicit custom path and identity handshake; a path alone cannot connect", async () => {
    const directory = await temporaryProject();
    await trustProject(directory);
    const executable = join(directory, "agent");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o755);
    let launches = 0;
    let closed = 0;
    const registry = new ConnectionRegistry(
      directory,
      async () => detected("/bin/codex"),
      async () => {
        launches++;
        return {
          inspect: async () => {
            throw new Error("handshake rejected");
          },
          close: () => {
            closed++;
          },
        };
      },
    );
    const { server, url } = await startLocalServer({
      sessionToken: null,
      projectDirectory: directory,
      port: 0,
      connections: registry,
    });
    try {
      const initial = (await fetch(`${url}/api/agents`).then((response) => response.json())) as {
        agents: AgentConnection[];
      };
      expect(initial.agents.find((item) => item.provider === "custom")?.protocol).toBeUndefined();
      expect(launches).toBe(0);
      const invalid = await fetch(`${url}/api/agents/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "custom",
          executable: "relative-agent",
          protocol: "codex-app-server",
          launch: true,
        }),
      });
      expect(invalid.status).toBe(400);
      expect(launches).toBe(0);
      const failed = await fetch(`${url}/api/agents/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "custom",
          executable,
          protocol: "codex-app-server",
          launch: true,
        }),
      });
      expect(failed.status).toBe(422);
      expect(((await failed.json()) as { error: string }).error).toMatch(/handshake rejected/);
      expect(closed).toBe(1);
      const listed = (await fetch(`${url}/api/agents`).then((response) => response.json())) as {
        agents: AgentConnection[];
      };
      expect(listed.agents.find((item) => item.provider === "custom")?.authentication).toBe(
        "unknown",
      );
    } finally {
      server.close();
    }
  });

  it("connects a custom executable only after its verified compatible handshake", async () => {
    const directory = await temporaryProject();
    await trustProject(directory);
    const executable = join(directory, "codex-compatible");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o755);
    const registry = new ConnectionRegistry(
      directory,
      async () => detected("/bin/codex"),
      async (path) => ({ inspect: async () => inspected(path), close: () => {} }),
    );
    const { server, url } = await startLocalServer({
      sessionToken: null,
      projectDirectory: directory,
      port: 0,
      connections: registry,
    });
    try {
      const request = {
        provider: "custom",
        executable,
        protocol: "codex-app-server",
        launch: true,
      };
      const response = await fetch(`${url}/api/agents/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      expect(response.status).toBe(200);
      const { connection } = (await response.json()) as { connection: AgentConnection };
      expect(connection).toMatchObject({
        provider: "custom",
        identity: "Codex CLI",
        authentication: "authenticated",
        protocol: "codex-app-server",
      });
      const saved = await fetch(`${url}/api/project/setup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Custom",
          revision: null,
          customAgent: { executable, protocol: "codex-app-server" },
          defaultBinding: { provider: "custom", model: "model-a" },
        }),
      });
      expect(saved.status).toBe(200);
      expect((await readProjectConfig(directory))?.customAgent?.executable).toBe(executable);
    } finally {
      server.close();
    }
  });

  it("persists verified defaults while existing run snapshots keep resolved bindings", async () => {
    const directory = await temporaryProject();
    const registry = new ConnectionRegistry(
      directory,
      async () => detected("/bin/codex"),
      async (executable) => ({
        inspect: async () => inspected(executable, ["model-a", "model-b"]),
        close: () => {},
      }),
    );
    const { server, url } = await startLocalServer({
      sessionToken: null,
      projectDirectory: directory,
      port: 0,
      connections: registry,
    });
    try {
      await fetch(`${url}/api/agents/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "codex", launch: true }),
      });
      const save = (revision: string | null, model: string) =>
        fetch(`${url}/api/project/setup`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Project",
            revision,
            defaultBinding: { provider: "codex", model, effort: "high" },
          }),
        });
      const first = (await (await save(null, "model-a")).json()) as { revision: string };
      const config = await readProjectConfig(directory);
      expect(config?.defaultBinding).toEqual({
        provider: "codex",
        model: "model-a",
        effort: "high",
      });
      const draft = createLoopDraft("one-step", "One step");
      const loop = parseLoop({
        ...draft,
        status: "published",
        steps: [
          {
            id: "implement",
            name: "Implement",
            kind: "agent",
            role: "Implementer",
            instruction: "Implement task",
          },
        ],
      });
      const run = createRunSnapshot(loop, { description: "Task" }, config!.defaultBinding!);
      await save(first.revision, "model-b");
      expect((await readProjectConfig(directory))?.defaultBinding?.model).toBe("model-b");
      expect(run.projectDefault).toEqual({ provider: "codex", model: "model-a", effort: "high" });
      expect(run.bindings.implement?.model).toBe("model-a");
    } finally {
      server.close();
    }
  });
});

describe("remembered connections", () => {
  const makeAdapter = (provider: "codex" | "kiro") => async () => ({
    inspect: async (): Promise<AgentConnection> => ({
      ...detected("/bin/x")[0]!,
      provider,
      executable: `/bin/${provider}`,
      identity: provider,
      version: "1.0.0",
      protocol: "fixture",
      authentication: "authenticated",
    }),
    close: () => undefined,
  });
  const candidates = (): AgentConnection[] =>
    (["codex", "kiro"] as const).map((provider) => ({
      ...detected("/bin/x")[0]!,
      provider,
      executable: `/bin/${provider}`,
    }));

  it("connects remembered agents again after a restart and keeps the rest unaffected", async () => {
    const project = await temporaryProject();
    const memory = userConnectionMemory(project);
    const first = new ConnectionRegistry(
      project,
      async () => candidates(),
      makeAdapter("codex"),
      makeAdapter("kiro"),
      undefined,
      memory,
    );
    await first.connect({ provider: "codex", launch: true });
    await first.connect({ provider: "kiro", launch: true });
    first.close();

    // Codex no longer starts; Kiro still does.
    const second = new ConnectionRegistry(
      project,
      async () => candidates(),
      async () => {
        throw new Error("codex is gone");
      },
      makeAdapter("kiro"),
      undefined,
      userConnectionMemory(project),
    );
    await second.restore(async () => undefined);
    const listed = await second.list();
    expect(listed.find((item) => item.provider === "kiro")?.protocol).toBe("fixture");
    expect(listed.find((item) => item.provider === "codex")?.protocol).toBeUndefined();
    second.close();
  });

  it("restores through the launch authorization, so an untrusted launch stays disconnected", async () => {
    const project = await temporaryProject();
    const first = new ConnectionRegistry(
      project,
      async () => candidates(),
      makeAdapter("codex"),
      makeAdapter("kiro"),
      undefined,
      userConnectionMemory(project),
    );
    await first.connect({ provider: "codex", launch: true });
    first.close();
    const second = new ConnectionRegistry(
      project,
      async () => candidates(),
      makeAdapter("codex"),
      makeAdapter("kiro"),
      undefined,
      userConnectionMemory(project),
    );
    await second.restore(async () => {
      throw new Error("project not trusted");
    });
    expect(
      (await second.list()).find((item) => item.provider === "codex")?.protocol,
    ).toBeUndefined();
    second.close();
  });

  it("reports a corrupt connections file instead of overwriting it", async () => {
    const project = await temporaryProject();
    const path = join(trustDirectory(), "connections.json");
    await mkdir(trustDirectory(), { recursive: true });
    await writeFile(path, "{ not json");
    const memory = userConnectionMemory(project);
    await expect(memory.read()).rejects.toThrow("Invalid connections file");
    await expect(memory.remember({ provider: "codex", launch: true })).rejects.toThrow(
      "Invalid connections file",
    );
    expect(await readFile(path, "utf8")).toBe("{ not json");
    await rm(path);
  });
});
