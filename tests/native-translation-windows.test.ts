import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { nativeCandidates, nativeFormats } from "../src/runtime/native-translation.js";
import { startLocalServer } from "../src/runtime/server.js";

// The secure native-file helper requires POSIX openat operations; fail explicitly on Windows.
it.runIf(process.platform === "win32")(
  "returns 501 without touching native configuration",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "factory-native-windows-"));
    await mkdir(join(directory, ".cursor", "rules"), { recursive: true });
    const rule = join(directory, ".cursor", "rules", "keep.mdc");
    await writeFile(rule, "user-owned rule");
    const { server, url } = await startLocalServer({
      projectDirectory: directory,
      sessionToken: null,
      port: 0,
    });
    try {
      expect(nativeFormats()).toEqual([]);
      const formats = await fetch(`${url}/api/native/formats`);
      expect(await formats.json()).toEqual({ formats: [] });
      await expect(nativeCandidates(directory, "cursor-rule-mdc")).rejects.toMatchObject({
        status: 501,
      });
      const response = await fetch(`${url}/api/native/candidates?format=cursor-rule-mdc`);
      expect(response.status).toBe(501);
      expect(await response.json()).toEqual({
        error: "Native translation requires Python 3 with POSIX directory operations.",
      });
      expect(await readFile(rule, "utf8")).toBe("user-owned rule");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
