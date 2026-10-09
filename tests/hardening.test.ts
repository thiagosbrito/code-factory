import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot, runRecordSchema } from "../src/domain/run.js";
import { startLocalServer } from "../src/runtime/server.js";
import { createSessionToken, sessionCookieName } from "../src/runtime/session.js";

const roots: string[] = [];
const servers: Awaited<ReturnType<typeof startLocalServer>>[] = [];
afterEach(async () => {
  for (const { server } of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const project = async () => {
  const root = await mkdtemp(join(tmpdir(), "factory-hardening-"));
  roots.push(root);
  return root;
};
const start = async (sessionToken: string | null) => {
  const local = await startLocalServer({
    projectDirectory: await project(),
    sessionToken,
    port: 0,
  });
  servers.push(local);
  return local;
};

describe("API session token", () => {
  it("refuses the API without the session and lets the printed link in", async () => {
    const token = createSessionToken();
    const { url, loginUrl } = await start(token);
    expect(loginUrl).toBe(`${url}/?token=${token}`);

    const anonymous = await fetch(`${url}/api/project`);
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).error).toContain("link `code-factory start` printed");
    // A wrong token is refused outright, and the page itself still loads for the error view.
    expect((await fetch(`${url}/?token=${token}x`, { redirect: "manual" })).status).toBe(403);
    expect(
      (await fetch(`${url}/api/health`, { headers: { Authorization: "Bearer nope" } })).status,
    ).toBe(401);

    const login = await fetch(loginUrl, { redirect: "manual" });
    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe("/");
    const setCookie = login.headers.get("set-cookie") ?? "";
    const port = new URL(url).port;
    expect(setCookie).toMatch(new RegExp(`^${sessionCookieName(Number(port))}=`));
    expect(setCookie).toContain("HttpOnly; SameSite=Strict; Path=/");
    const cookie = setCookie.split(";")[0] ?? "";
    expect((await fetch(`${url}/api/project`, { headers: { Cookie: cookie } })).status).toBe(200);
    expect(
      (await fetch(`${url}/api/health`, { headers: { Authorization: `Bearer ${token}` } })).status,
    ).toBe(200);
  });

  it("keeps runtimes on different ports from sharing a session", async () => {
    const first = await start(createSessionToken());
    const second = await start(createSessionToken());
    const login = await fetch(first.loginUrl, { redirect: "manual" });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    // Cookies ignore ports, so the browser would send the first runtime's cookie to the second.
    expect((await fetch(`${second.url}/api/health`, { headers: { Cookie: cookie } })).status).toBe(
      401,
    );
  });

  it("serves an in-process harness without a session when it passes null", async () => {
    const { url, loginUrl } = await start(null);
    expect(loginUrl).toBe(url);
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
  });
});

describe("tracker key", () => {
  it("is removed from the environment every agent and command inherits", async () => {
    process.env.CODE_FACTORY_LINEAR_API_KEY = "lin_secret";
    try {
      const { url } = await start(null);
      expect(process.env.CODE_FACTORY_LINEAR_API_KEY).toBeUndefined();
      expect(await (await fetch(`${url}/api/tracker`)).json()).toMatchObject({ configured: true });
    } finally {
      delete process.env.CODE_FACTORY_LINEAR_API_KEY;
    }
  });
});

describe("stored Git refs", () => {
  const record = (checkout: { previousBranch: string | null; previousRevision: string }) =>
    createRunRecord(
      createRunSnapshot(
        parseLoop({
          schemaVersion: 2,
          id: "flow",
          name: "Flow",
          version: 1,
          status: "published",
          steps: [{ id: "a", name: "A", kind: "check", role: "a", instruction: "true" }],
          dependencies: [],
          groups: [],
          joins: [],
          decisions: [],
          policy: { maxAttemptsPerStep: 1 },
        }),
        { description: "x" },
        { provider: "mock", model: "default" },
        {
          id: "baseline",
          kind: "git",
          revision: "0123abcd",
          workspace: ".",
          branch: "code-factory/0123abcd",
          checkout,
          capturedAt: new Date().toISOString(),
        },
      ),
    );

  it("rejects a run record whose branch or revision Git would read as an option", () => {
    expect(
      runRecordSchema.safeParse(record({ previousBranch: "main", previousRevision: "0123abcd" }))
        .success,
    ).toBe(true);
    for (const checkout of [
      { previousBranch: "--orphan=evil", previousRevision: "0123abcd" },
      { previousBranch: "main", previousRevision: "--output=/tmp/x" },
      { previousBranch: "a b", previousRevision: "0123abcd" },
      { previousBranch: "main..other", previousRevision: "0123abcd" },
    ])
      expect(() => record(checkout)).toThrow("Stored Git branch or revision is not a valid ref.");
  });
});
