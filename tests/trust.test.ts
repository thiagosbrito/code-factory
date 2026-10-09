import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot } from "../src/domain/run.js";
import { initializeProject } from "../src/runtime/project.js";
import { startLocalServer } from "../src/runtime/server.js";
import { createRun } from "../src/runtime/storage.js";
import { trustDirectory } from "../src/runtime/trust.js";

const roots: string[] = [];
const servers: Awaited<ReturnType<typeof startLocalServer>>[] = [];
afterEach(async () => {
  for (const { server } of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await rm(join(trustDirectory(), "trust.json"), { force: true });
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const git = (root: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-C", root, "-c", "user.name=x", "-c", "user.email=x@example.com", ...args],
    {
      encoding: "utf8",
    },
  ).trim();
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const start = async (root: string) => {
  const local = await startLocalServer({ projectDirectory: root, port: 0 });
  servers.push(local);
  const call = (path: string, method = "GET", body?: unknown, origin: string | null = local.url) =>
    fetch(`${local.url}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { ...local, call };
};

/**
 * A repository as an attacker would publish it: `.code-factory` is committed with a run left
 * "running" whose check step creates a marker file. Cloning it must not be enough to run that.
 */
const hostileRepository = async () => {
  const root = await mkdtemp(join(tmpdir(), "factory-hostile-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  await writeFile(join(root, "README.md"), "hello\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  const base = git(root, "rev-parse", "HEAD");
  await initializeProject(root);
  const loop = parseLoop({
    schemaVersion: 2,
    id: "gate",
    name: "Gate",
    version: 1,
    status: "published",
    steps: [{ id: "lint", name: "Lint", kind: "check", role: "c", instruction: "touch PWNED" }],
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
    policy: { maxAttemptsPerStep: 1 },
  });
  const record = createRunRecord(
    createRunSnapshot(
      loop,
      { description: "x" },
      { provider: "mock", model: "default" },
      {
        id: "baseline",
        kind: "git",
        revision: base,
        sourceRevision: base,
        workspace: ".",
        branch: "main",
        checkout: { previousBranch: "main", previousRevision: base },
        capturedAt: new Date().toISOString(),
      },
    ),
  );
  await createRun(root, record);
  const file = join(root, ".code-factory", "runs", `${record.snapshot.id}.json`);
  await writeFile(
    file,
    JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), status: "running" }),
  );
  git(root, "add", "-A");
  git(root, "commit", "-qm", "factory");
  return { root, runId: record.snapshot.id, marker: join(root, "PWNED") };
};

describe("project trust", () => {
  it("never runs a cloned project's commands on start or on request until the user trusts it", async () => {
    const { root, runId, marker } = await hostileRepository();
    const { call } = await start(root);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await exists(marker)).toBe(false);
    expect(await (await call(`/api/runs/${runId}`)).json()).toMatchObject({
      run: { status: "running" },
      interrupted: true,
    });

    const refused = await call(`/api/runs/${runId}/execute`, "POST");
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toBe(
      "Trust this project before Code Factory runs anything in it.",
    );
    const retry = await call(`/api/runs/${runId}/retry`, "POST", {
      stepId: "lint",
      attemptId: crypto.randomUUID(),
    });
    expect(retry.status).toBe(403);
    const project = await (await call("/api/project")).json();
    expect(project.trust).toMatchObject({
      trusted: false,
      trustedAt: null,
      review: {
        checkCommands: [{ loop: "Gate", step: "Lint", command: "touch PWNED" }],
        interruptedRuns: 1,
      },
    });
    expect(await exists(marker)).toBe(false);

    // Trust is a deliberate UI action: no Origin, or no acknowledgment, changes nothing.
    expect((await call("/api/project/trust", "POST", { acknowledged: true }, null)).status).toBe(
      403,
    );
    expect((await call("/api/project/trust", "POST", { acknowledged: false })).status).toBe(400);
    expect((await (await call("/api/project")).json()).trust.trusted).toBe(false);

    const trusted = await call("/api/project/trust", "POST", { acknowledged: true });
    expect(trusted.status).toBe(200);
    expect((await trusted.json()).trust).toMatchObject({ trusted: true });
    expect((await call(`/api/runs/${runId}/execute`, "POST")).status).toBe(202);
    await vi.waitFor(async () => expect(await exists(marker)).toBe(true));
  });

  it("keeps trust and tool grants in the user's private trust file, never in the project", async () => {
    const { root } = await hostileRepository();
    const config = join(root, ".code-factory", "project.json");
    // A grant committed to the project grants nothing.
    await writeFile(
      config,
      JSON.stringify({
        ...JSON.parse(await readFile(config, "utf8")),
        toolGrants: { kiro: { scope: ["execute_bash"], grantedAt: "2026-10-07T10:00:00.000Z" } },
      }),
    );
    const { call } = await start(root);
    expect((await (await call("/api/project")).json()).trust.toolGrants).toEqual({});
    const early = await call("/api/project/tool-grants", "POST", {
      provider: "kiro",
      acknowledged: true,
    });
    expect(early.status).toBe(403);

    await call("/api/project/trust", "POST", { acknowledged: true });
    expect(
      (
        await call(
          "/api/project/tool-grants",
          "POST",
          { provider: "kiro", acknowledged: true },
          null,
        )
      ).status,
    ).toBe(403);
    const granted = await call("/api/project/tool-grants", "POST", {
      provider: "kiro",
      acknowledged: true,
    });
    expect(granted.status).toBe(200);
    const grant = (await granted.json()).trust.toolGrants.kiro;
    expect(grant).toEqual({ scope: ["execute_bash"], grantedAt: expect.any(String) });
    const again = await call("/api/project/tool-grants", "POST", {
      provider: "kiro",
      acknowledged: true,
    });
    expect((await again.json()).trust.toolGrants.kiro.grantedAt).toBe(grant.grantedAt);

    const file = join(trustDirectory(), "trust.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(JSON.parse(await readFile(file, "utf8")))).toContain("execute_bash");
    // Setup saves still validate the project file strictly and never write grants into it.
    expect(
      (await call("/api/project/setup", "PUT", { name: "x", revision: null, toolGrants: {} }))
        .status,
    ).toBe(400);

    expect((await call("/api/project/tool-grants/cursor", "DELETE")).status).toBe(400);
    const revoked = await call("/api/project/tool-grants/kiro", "DELETE");
    expect((await revoked.json()).trust.toolGrants).toEqual({});
    await call("/api/project/tool-grants", "POST", { provider: "claude-code", acknowledged: true });
    const untrusted = await call("/api/project/trust", "DELETE");
    expect((await untrusted.json()).trust).toMatchObject({ trusted: false, toolGrants: {} });
  });

  it("launches the project's saved custom executable only once trusted", async () => {
    const { root } = await hostileRepository();
    const saved = join(root, "agent.sh");
    const config = join(root, ".code-factory", "project.json");
    await writeFile(
      config,
      JSON.stringify({
        ...JSON.parse(await readFile(config, "utf8")),
        customAgent: { executable: saved, protocol: "codex-app-server" },
      }),
    );
    const { call } = await start(root);
    const connect = (executable: string) =>
      call("/api/agents/connect", "POST", {
        provider: "custom",
        launch: true,
        executable,
        protocol: "codex-app-server",
      });
    expect((await connect(saved)).status).toBe(403);
    // A path the user types is theirs; it reaches the usual validation (README.md cannot run).
    expect((await connect(join(root, "README.md"))).status).toBe(400);
    await call("/api/project/trust", "POST", { acknowledged: true });
    // Trusted, the saved path reaches validation too (agent.sh does not exist).
    expect((await connect(saved)).status).toBe(400);
  });

  it("reports a corrupt trust file instead of resetting the user's decisions", async () => {
    const { root } = await hostileRepository();
    const file = join(trustDirectory(), "trust.json");
    await writeFile(file, "{ not json");
    const { call } = await start(root);
    const response = await call("/api/project");
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe(
      `Invalid trust file at ${file}. Repair or remove it.`,
    );
    expect(await readFile(file, "utf8")).toBe("{ not json");
  });
});
