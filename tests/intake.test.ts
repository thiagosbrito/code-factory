import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConnection } from "../src/adapters/contract.js";
import { createLoopDraft, parseLoop } from "../src/domain/loop.js";
import { startRun } from "../src/runtime/intake.js";
import { initializeProject, projectRevision, saveProjectSetup } from "../src/runtime/project.js";
import { ConnectionRegistry } from "../src/runtime/connections.js";
import { startLocalServer } from "../src/runtime/server.js";
import { publishDraft, readRun, saveDraft } from "../src/runtime/storage.js";
import { linearTracker, type TicketTracker } from "../src/runtime/tracker.js";

const roots: string[] = [];
const agent: AgentConnection = {
  provider: "codex",
  executable: "/bin/codex",
  installation: "detected",
  authentication: "authenticated",
  protocol: "codex-app-server",
  version: "test",
  identity: "codex",
  capabilities: {
    streaming: "supported",
    steering: "unknown",
    resume: "unknown",
    pause: "unsupported",
    waitingInput: "unknown",
  },
  models: [{ id: "agent-default", displayName: "Default" }],
};
async function project() {
  const root = await mkdtemp(join(tmpdir(), "factory-intake-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", root]);
  await writeFile(join(root, "file.txt"), "original\n");
  execFileSync("git", ["-C", root, "add", "file.txt"]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "Initial",
  ]);
  await initializeProject(root);
  await saveProjectSetup(root, {
    name: "Selected project",
    revision: await projectRevision(root),
    defaultBinding: { provider: "codex", model: "agent-default" },
  });
  const draft = parseLoop({
    ...createLoopDraft("real-loop", "Real loop"),
    steps: [{ id: "build", name: "Build", kind: "agent", role: "builder", instruction: "Build" }],
  });
  await saveDraft(root, draft);
  await publishDraft(root, draft.id);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function input(overrides: Record<string, unknown> = {}) {
  return {
    requestId: crypto.randomUUID(),
    project: "selected",
    loopId: "real-loop",
    loopVersion: 1,
    description: "Do the work",
    ...overrides,
  };
}

describe("protected run intake", () => {
  it("starts description-only without a tracker and keeps exact published version and binding", async () => {
    const root = await project();
    const request = input();
    const run = await startRun(root, request, [agent]);
    expect(run.snapshot.task).toEqual({ description: "Do the work" });
    expect(run.snapshot.loop).toMatchObject({ id: "real-loop", version: 1, status: "published" });
    expect(run.snapshot.bindings.build).toEqual({ provider: "codex", model: "agent-default" });
    expect(run.snapshot.baseline).toMatchObject({
      kind: "git",
      revision: expect.any(String),
      workspace: expect.any(String),
    });
    expect((await readRun(root, run.snapshot.id))?.snapshot.id).toBe(request.requestId);
    expect(await startRun(root, request, [agent])).toEqual(run);
  });

  it("accepts ticket-only and combined input, and snapshots retrieved attachments", async () => {
    const root = await project();
    const tracker: TicketTracker = {
      retrieve: async (id) => ({
        id,
        title: "Actual title",
        summary: "Full tracker description",
        attachments: [{ title: "spec.md", url: "https://example.com/spec" }],
      }),
    };
    const ticketOnly = await startRun(
      root,
      input({ description: "", ticketId: "THI-9" }),
      [agent],
      tracker,
    );
    expect(ticketOnly.snapshot.task.ticket).toMatchObject({
      title: "Actual title",
      summary: "Full tracker description",
      attachments: [{ title: "spec.md" }],
    });
    const combined = await startRun(
      root,
      input({ description: "Additional constraints", ticketId: "THI-9" }),
      [agent],
      tracker,
    );
    expect(combined.snapshot.task.description).toBe("Additional constraints");
    expect(combined.snapshot.task.ticket?.id).toBe("THI-9");
  });

  it("starts a ticket-only run for agent MCP lookup when no direct tracker is configured", async () => {
    const root = await project();
    const request = input({ description: "", ticketId: "PROJ-123" });
    const run = await startRun(root, request, [agent]);
    expect(run.snapshot.task).toEqual({ description: "", ticketId: "PROJ-123" });
    expect(await startRun(root, request, [agent])).toEqual(run);
  });

  it("rejects empty input, missing publication, unverified connection, and failed ticket", async () => {
    const root = await project();
    await expect(startRun(root, input({ description: "" }), [agent])).rejects.toThrow(
      /description or ticket/,
    );
    await expect(startRun(root, input({ loopVersion: 8 }), [agent])).rejects.toThrow(
      /published loop/,
    );
    await expect(
      startRun(root, input(), [{ ...agent, authentication: "unknown" }]),
    ).rejects.toThrow(/Verify and authenticate/);
    await expect(
      startRun(root, input({ description: "Extra", ticketId: "THI-9" }), [agent], {
        retrieve: async () => {
          throw new Error("not found");
        },
      }),
    ).rejects.toThrow(/not found/);
    expect(await readRun(root, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("preserves staged, unstaged, deleted and untracked work in separate writing workspaces", async () => {
    const root = await project();
    await writeFile(join(root, "staged.txt"), "before staging\n");
    await writeFile(join(root, "deleted.txt"), "to delete\n");
    execFileSync("git", ["-C", root, "add", "staged.txt", "deleted.txt"]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "More files",
    ]);
    await writeFile(join(root, "file.txt"), "staged\n");
    execFileSync("git", ["-C", root, "add", "file.txt"]);
    await writeFile(join(root, "file.txt"), "unstaged\n");
    await writeFile(join(root, "staged.txt"), "only staged\n");
    execFileSync("git", ["-C", root, "add", "staged.txt"]);
    await rm(join(root, "deleted.txt"));
    execFileSync("git", ["-C", root, "add", "-u", "deleted.txt"]);
    await writeFile(join(root, "new.txt"), "untracked\n");
    const [first, second] = await Promise.all([
      startRun(root, input(), [agent]),
      startRun(root, input(), [agent]),
    ]);
    const firstWorkspace = join(root, first.snapshot.baseline.workspace!);
    const secondWorkspace = join(root, second.snapshot.baseline.workspace!);
    expect(firstWorkspace).not.toBe(secondWorkspace);
    expect(await readFile(join(firstWorkspace, "file.txt"), "utf8")).toBe("unstaged\n");
    expect(await readFile(join(secondWorkspace, "new.txt"), "utf8")).toBe("untracked\n");
    expect(await readFile(join(secondWorkspace, "staged.txt"), "utf8")).toBe("only staged\n");
    await expect(readFile(join(secondWorkspace, "deleted.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await writeFile(join(firstWorkspace, "file.txt"), "run one edit\n");
    expect(await readFile(join(secondWorkspace, "file.txt"), "utf8")).toBe("unstaged\n");
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("unstaged\n");
    expect(first.snapshot.baseline.changes).toEqual([
      "deleted.txt",
      "file.txt",
      "new.txt",
      "staged.txt",
    ]);
    expect(
      execFileSync(
        "git",
        ["-C", firstWorkspace, "show", `${first.snapshot.baseline.revision}:file.txt`],
        { encoding: "utf8" },
      ),
    ).toBe("unstaged\n");
    expect(first.snapshot.baseline.sourceRevision).toBe(
      execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    );
  });

  it("deduplicates repeated submissions and rejects a reused request ID with different content", async () => {
    const root = await project();
    const request = input();
    const [one, two] = await Promise.all([
      startRun(root, request, [agent]),
      startRun(root, request, [agent]),
    ]);
    expect(one.snapshot.id).toBe(two.snapshot.id);
    await expect(startRun(root, { ...request, description: "Different" }, [agent])).rejects.toThrow(
      /already belongs/,
    );
  });

  it("rejects links that could write outside the isolated workspace", async () => {
    const root = await project();
    await symlink(tmpdir(), join(root, "outside"));
    await expect(startRun(root, input(), [agent])).rejects.toThrow(/Workspace link escapes/);
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("original\n");
  });

  it("exposes the saved run ID and actual published loop through the local API", async () => {
    const root = await project();
    const connections = new ConnectionRegistry(root, async () => [agent]);
    const { server, url } = await startLocalServer({
      projectDirectory: root,
      port: 0,
      connections,
    });
    try {
      const loops = (await fetch(`${url}/api/loops/published`).then((response) =>
        response.json(),
      )) as { loops: unknown[] };
      expect(loops.loops[0]).toMatchObject({ id: "real-loop", version: 1 });
      const request = input();
      const response = await fetch(`${url}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ runId: request.requestId });
      expect(
        await fetch(`${url}/api/runs/${request.requestId}`).then((result) => result.json()),
      ).toMatchObject({ run: { snapshot: { task: { description: "Do the work" } } } });
      expect(
        ((await fetch(`${url}/api/runs`).then((result) => result.json())) as { runs: unknown[] })
          .runs,
      ).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("Linear retrieval", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("maps full material and distinguishes not-found, authentication, and service errors", async () => {
    const tracker = linearTracker("test-token");
    const fetcher = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
      async (_url, options) => {
        const id = (JSON.parse(String(options.body)) as { variables: { id: string } }).variables.id;
        if (id === "THI-1")
          return new Response(
            JSON.stringify({
              data: {
                issue: {
                  identifier: id,
                  title: "Title",
                  description: "Description",
                  attachments: { nodes: [{ title: "spec", url: "https://example.com/spec" }] },
                },
              },
            }),
            { status: 200 },
          );
        if (id === "THI-2")
          return new Response(JSON.stringify({ data: { issue: null } }), { status: 200 });
        if (id === "THI-3") return new Response("{}", { status: 401 });
        if (id === "THI-5")
          return new Response(
            JSON.stringify({
              errors: [
                { message: "Unauthenticated", extensions: { code: "AUTHENTICATION_ERROR" } },
              ],
            }),
            { status: 200 },
          );
        return new Response("{}", { status: 503 });
      },
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await tracker.retrieve("thi-1")).toMatchObject({
      title: "Title",
      summary: "Description",
      attachments: [{ title: "spec" }],
    });
    await expect(tracker.retrieve("THI-2")).rejects.toMatchObject({ status: 404 });
    await expect(tracker.retrieve("THI-3")).rejects.toMatchObject({ status: 401 });
    await expect(tracker.retrieve("THI-4")).rejects.toMatchObject({ status: 502 });
    await expect(tracker.retrieve("THI-5")).rejects.toMatchObject({ status: 401 });
    expect(fetcher.mock.calls[0]?.[1].headers).toMatchObject({ Authorization: "test-token" });
  });
});
