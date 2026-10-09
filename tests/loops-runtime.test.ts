import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLoopDraft, parseLoop } from "../src/domain/loop.js";
import {
  createRunFromPublished,
  listLoops,
  readPublishedVersion,
  saveDraft,
} from "../src/runtime/storage.js";
import { initializeProject } from "../src/runtime/project.js";
import { startLocalServer } from "../src/runtime/server.js";
import { ConnectionRegistry } from "../src/runtime/connections.js";
import type { AgentConnection } from "../src/adapters/contract.js";

const projects: string[] = [];
const servers: { close: (callback: () => void) => void }[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))),
  );
  await Promise.all(projects.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function project() {
  const path = await mkdtemp(join(tmpdir(), "code-factory-loop-api-"));
  projects.push(path);
  await initializeProject(path);
  return path;
}
const connected: AgentConnection = {
  provider: "codex",
  executable: "/bin/codex",
  installation: "detected",
  identity: "Codex CLI",
  version: "fixture",
  protocol: "codex-app-server",
  authentication: "authenticated",
  capabilities: {
    streaming: "unknown",
    steering: "unknown",
    resume: "unknown",
    pause: "unsupported",
    waitingInput: "unknown",
  },
  models: [{ id: "model-a", displayName: "Model A", efforts: ["low"] }],
};
function draft() {
  return parseLoop({
    ...createLoopDraft("my-loop", "My loop"),
    steps: [
      {
        id: "build",
        name: "Build",
        kind: "agent",
        role: "Builder",
        instruction: "Build it",
        expectedOutputs: ["Patch"],
      },
    ],
  });
}

describe("durable loop library and publication API", () => {
  it("lists only saved loops and persists drafts across reads", async () => {
    const path = await project();
    expect(await listLoops(path)).toEqual([]);
    await saveDraft(path, draft());
    const listed = await listLoops(path);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.draft?.steps[0]?.name).toBe("Build");
    expect(listed[0]?.published).toBeNull();
  });
  it("rejects empty/unbound publication and keeps published/run snapshots immutable after edits", async () => {
    const path = await project();
    const registry = new ConnectionRegistry(
      path,
      async () => [connected],
      async () => ({ inspect: async () => connected, close() {} }),
    );
    const { server, url } = await startLocalServer({
      sessionToken: null,
      projectDirectory: path,
      port: 0,
      connections: registry,
    });
    servers.push(server);
    const empty = createLoopDraft("my-loop", "My loop");
    const put = (value: unknown) =>
      fetch(`${url}/api/loops/my-loop/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
    expect((await put(empty)).status).toBe(200);
    expect((await fetch(`${url}/api/loops/my-loop/publish`, { method: "POST" })).status).toBe(422);
    expect((await put(draft())).status).toBe(200);
    expect((await fetch(`${url}/api/loops/my-loop/publish`, { method: "POST" })).status).toBe(422);
    const incomplete = parseLoop({
      ...draft(),
      name: "  ",
      steps: [{ ...draft().steps[0], instruction: "  " }],
    });
    expect((await put(incomplete)).status).toBe(200);
    expect((await fetch(`${url}/api/loops/my-loop/publish`, { method: "POST" })).status).toBe(422);
    await registry.connect({ provider: "codex", launch: true });
    const bound = parseLoop({
      ...draft(),
      steps: [
        { ...draft().steps[0], binding: { provider: "codex", model: "model-a", effort: "low" } },
      ],
    });
    expect(
      (await put(parseLoop({ ...bound, steps: [{ ...bound.steps[0], expectedOutputs: [] }] })))
        .status,
    ).toBe(200);
    expect((await fetch(`${url}/api/loops/my-loop/publish`, { method: "POST" })).status).toBe(422);
    expect((await put(bound)).status).toBe(200);
    const publication = await fetch(`${url}/api/loops/my-loop/publish`, { method: "POST" });
    expect(publication.status).toBe(200);
    const version = await readPublishedVersion(path, "my-loop", 1);
    expect(version?.steps[0]?.instruction).toBe("Build it");
    const baseline = {
      id: "baseline",
      kind: "git" as const,
      revision: "a".repeat(40),
      capturedAt: new Date().toISOString(),
    };
    const run = await createRunFromPublished(
      path,
      "my-loop",
      1,
      { description: "Do work" },
      { provider: "codex", model: "model-a", effort: "low" },
      baseline,
    );
    const future = parseLoop({
      ...bound,
      version: 2,
      steps: [{ ...bound.steps[0], instruction: "Different future work" }],
    });
    expect((await put(future)).status).toBe(200);
    expect((await readPublishedVersion(path, "my-loop", 1))?.steps[0]?.instruction).toBe(
      "Build it",
    );
    expect(run.snapshot.loop.steps[0]?.instruction).toBe("Build it");
    expect((await fetch(`${url}/api/loops`)).status).toBe(200);
  });
});
