import { execFile } from "node:child_process";
import { chmod, mkdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  readProjectTrust,
  trustDirectory,
  trustProject,
  untrustProject,
} from "../src/runtime/trust.js";
import { exists, roots, servers, temporary } from "./support/trust.js";

afterEach(async () => {
  for (const { server } of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await rm(join(trustDirectory(), "trust.json"), { force: true });
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
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
