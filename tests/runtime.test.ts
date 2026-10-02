import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeProject, readProjectConfig } from "../src/runtime/project.js";
import { discoverAgents } from "../src/adapters/discovery.js";
import { startLocalServer } from "../src/runtime/server.js";

const directories: string[] = [];
async function temporaryProject() {
  const directory = await mkdtemp(join(tmpdir(), "code-factory-test-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("project initialization", () => {
  it("starts blank, preserves agent files, and refuses to replace existing configuration", async () => {
    const directory = await temporaryProject();
    await mkdir(join(directory, ".kiro"));
    await writeFile(join(directory, ".kiro", "keep.txt"), "existing instructions");
    expect(await readProjectConfig(directory)).toBeNull();
    const config = await initializeProject(directory);
    expect(config.defaultBinding).toBeNull();
    expect(await readProjectConfig(directory)).toEqual(config);
    await expect(initializeProject(directory)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(directory, ".kiro", "keep.txt"), "utf8")).toBe(
      "existing instructions",
    );
  });
  it("reports corrupt configuration rather than silently resetting it", async () => {
    const directory = await temporaryProject();
    await initializeProject(directory);
    await writeFile(join(directory, ".code-factory", "project.json"), "bad json");
    await expect(readProjectConfig(directory)).rejects.toThrow(/JSON/);
  });
});

describe("agent discovery", () => {
  it("distinguishes installation from authentication and negotiated capabilities", async () => {
    const directory = await temporaryProject();
    await writeFile(join(directory, "codex"), "#!/bin/sh\nexit 99\n");
    await chmod(join(directory, "codex"), 0o755);
    const agents = await discoverAgents(directory);
    expect(agents.find((agent) => agent.provider === "codex")).toMatchObject({
      installation: "detected",
      authentication: "unknown",
      capabilities: { streaming: "unknown" },
    });
    expect(agents.find((agent) => agent.provider === "kiro")?.installation).toBe("missing");
  });
});

describe("local API", () => {
  it("serves project state and assets without claiming runtime integration", async () => {
    const directory = await temporaryProject();
    await initializeProject(directory);
    const ui = join(directory, "ui");
    await mkdir(ui);
    await writeFile(join(ui, "index.html"), "<h1>Test shell</h1>");
    const { server, url } = await startLocalServer({
      projectDirectory: directory,
      uiDirectory: ui,
      port: 0,
    });
    try {
      expect(await fetch(`${url}/api/health`).then((response) => response.json())).toMatchObject({
        status: "ready",
        executionAvailable: false,
      });
      expect(await fetch(`${url}/api/project`).then((response) => response.json())).toMatchObject({
        project: { defaultBinding: null },
      });
      expect(await fetch(url).then((response) => response.text())).toContain("Test shell");
      expect((await fetch(`${url}/api/unknown`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolveClosed, reject) =>
        server.close((error) => (error ? reject(error) : resolveClosed())),
      );
    }
  });
  it("rejects foreign origins, host rebinding, and unsupported mutations", async () => {
    const { server, url } = await startLocalServer({
      projectDirectory: await temporaryProject(),
      port: 0,
    });
    try {
      expect(
        (await fetch(`${url}/api/project`, { headers: { Origin: "https://foreign.example" } }))
          .status,
      ).toBe(403);
      const foreignHostStatus = await new Promise<number>((resolveStatus, reject) => {
        const req = request(
          `${url}/api/health`,
          { headers: { Host: "foreign.example" } },
          (response) => {
            response.resume();
            resolveStatus(response.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(foreignHostStatus).toBe(403);
      expect((await fetch(`${url}/api/project`, { method: "POST" })).status).toBe(405);
    } finally {
      await new Promise<void>((resolveClosed, reject) =>
        server.close((error) => (error ? reject(error) : resolveClosed())),
      );
    }
  });
});
