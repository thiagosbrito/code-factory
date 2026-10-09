import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  chmod,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initializeProject,
  readProjectConfig,
  projectRevision,
  saveProjectSetup,
  validateProjectDirectory,
} from "../src/runtime/project.js";
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
    await expect(readProjectConfig(directory)).rejects.toThrow(/Invalid project configuration/);
    await expect(saveProjectSetup(directory, { name: "New", revision: null })).rejects.toThrow(
      /Invalid project configuration/,
    );
    expect(await readFile(join(directory, ".code-factory", "project.json"), "utf8")).toBe(
      "bad json",
    );
  });
  it("validates the selected directory and rejects linked factory storage", async () => {
    const directory = await temporaryProject();
    await expect(validateProjectDirectory(join(directory, "missing"))).rejects.toThrow(
      /does not exist/,
    );
    await writeFile(join(directory, "file"), "x");
    await expect(validateProjectDirectory(join(directory, "file"))).rejects.toThrow(
      /not a directory/,
    );
    const other = await temporaryProject();
    const alias = join(other, "alias");
    await symlink(directory, alias);
    expect(await validateProjectDirectory(alias)).toBe(await realpath(directory));
    await symlink(other, join(directory, ".code-factory"));
    await expect(initializeProject(directory)).rejects.toThrow(/regular directory/);
  });
  it("keeps other factory and agent files when setup is saved and reports write failures", async () => {
    const directory = await temporaryProject();
    await mkdir(join(directory, ".kiro"));
    await writeFile(join(directory, ".kiro", "agent.txt"), "private instructions");
    await mkdir(join(directory, ".code-factory"));
    await mkdir(join(directory, ".code-factory", "loops"));
    await writeFile(join(directory, ".code-factory", "loops", "keep.txt"), "existing loop");
    await saveProjectSetup(directory, { name: "Factory", revision: null });
    expect(await readFile(join(directory, ".kiro", "agent.txt"), "utf8")).toBe(
      "private instructions",
    );
    expect(await readFile(join(directory, ".code-factory", "loops", "keep.txt"), "utf8")).toBe(
      "existing loop",
    );
    const folder = join(directory, ".code-factory");
    const revision = await projectRevision(directory);
    await chmod(folder, 0o500);
    try {
      await expect(saveProjectSetup(directory, { name: "Cannot save", revision })).rejects.toThrow(
        /Check write permissions/,
      );
    } finally {
      await chmod(folder, 0o700);
    }
    expect((await readProjectConfig(directory))?.name).toBe("Factory");
  });
  it("saves a trimmed project name while retaining the binding and rejecting stale writes", async () => {
    const directory = await temporaryProject();
    await initializeProject(directory);
    const path = join(directory, ".code-factory", "project.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        name: "Before",
        defaultBinding: { provider: "codex", model: "saved-model" },
      }),
    );
    const revision = await projectRevision(directory);
    const saved = await saveProjectSetup(directory, { name: "  After  ", revision });
    expect(saved).toMatchObject({
      name: "After",
      defaultBinding: { provider: "codex", model: "saved-model" },
    });
    await expect(saveProjectSetup(directory, { name: "Stale", revision })).rejects.toThrow(
      /changed on disk/,
    );
    expect((await readProjectConfig(directory))?.name).toBe("After");
  });
  it("accepts only one of two concurrent setup saves from the same revision", async () => {
    const directory = await temporaryProject();
    await initializeProject(directory);
    const revision = await projectRevision(directory);
    const results = await Promise.allSettled([
      saveProjectSetup(directory, { name: "First", revision }),
      saveProjectSetup(directory, { name: "Second", revision }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    // Which save reaches the queue first depends on directory validation timing, so assert on
    // the winner rather than on call order.
    expect((await readProjectConfig(directory))?.name).toBe(fulfilled[0]?.value.name);
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
  it("starts with zero history and saves setup only in the trusted CLI project", async () => {
    const directory = await temporaryProject();
    const other = await temporaryProject();
    const { server, url } = await startLocalServer({
      sessionToken: null,
      projectDirectory: directory,
      port: 0,
    });
    try {
      expect(await fetch(`${url}/api/project`).then((response) => response.json())).toMatchObject({
        project: null,
        path: await realpath(directory),
        revision: null,
      });
      expect(await fetch(`${url}/api/factory`).then((response) => response.json())).toEqual({
        loops: 0,
        runs: 0,
      });
      const invalid = await fetch(`${url}/api/project/setup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: " ", revision: null }),
      });
      expect(invalid.status).toBe(400);
      const spoofed = await fetch(`${url}/api/project/setup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Safe", path: other, revision: null }),
      });
      expect(spoofed.status).toBe(400);
      const saved = await fetch(`${url}/api/project/setup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Local", revision: null }),
      });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({
        project: { name: "Local", defaultBinding: null },
      });
      expect(await readProjectConfig(other)).toBeNull();
      expect(await fetch(`${url}/api/factory`).then((response) => response.json())).toEqual({
        loops: 0,
        runs: 0,
      });
      expect(await fetch(`${url}/api/project`).then((response) => response.json())).toMatchObject({
        project: { name: "Local" },
      });
    } finally {
      await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    }
  });
  it("serves project state and assets with scheduler availability", async () => {
    const directory = await temporaryProject();
    await initializeProject(directory);
    const ui = join(directory, "ui");
    await mkdir(ui);
    await writeFile(join(ui, "index.html"), "<h1>Test shell</h1>");
    const { server, url } = await startLocalServer({
      sessionToken: null,
      projectDirectory: directory,
      uiDirectory: ui,
      port: 0,
    });
    try {
      expect(await fetch(`${url}/api/health`).then((response) => response.json())).toMatchObject({
        status: "ready",
        executionAvailable: true,
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
  it("sends anti-framing and content security headers on pages, API responses and errors", async () => {
    const directory = await temporaryProject();
    const ui = join(directory, "ui");
    await mkdir(ui);
    await writeFile(join(ui, "index.html"), "<h1>Test shell</h1>");
    await mkdir(join(ui, "assets"));
    await writeFile(join(ui, "assets", "app.js"), "export {};");
    const { server, url } = await startLocalServer({
      sessionToken: null,
      projectDirectory: directory,
      uiDirectory: ui,
      port: 0,
    });
    try {
      for (const response of [
        await fetch(url),
        await fetch(`${url}/assets/app.js`),
        await fetch(`${url}/assets/missing.js`),
        await fetch(`${url}/api/health`),
        await fetch(`${url}/api/unknown`),
        await fetch(`${url}/api/project`, { headers: { Origin: "https://foreign.example" } }),
      ]) {
        const csp = response.headers.get("content-security-policy") ?? "";
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).toContain("script-src 'self'");
        expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
        expect(response.headers.get("x-frame-options")).toBe("DENY");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
        expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      }
    } finally {
      await new Promise<void>((resolveClosed, reject) =>
        server.close((error) => (error ? reject(error) : resolveClosed())),
      );
    }
  });
  it("rejects foreign origins, host rebinding, and unsupported mutations", async () => {
    const { server, url } = await startLocalServer({
      sessionToken: null,
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
