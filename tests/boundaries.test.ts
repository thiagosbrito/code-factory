import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCodexMessage } from "../src/adapters/codex.js";
import { api, projectResponseSchema } from "../src/ui/shared/project-api.js";

afterEach(() => vi.unstubAllGlobals());

describe("external data boundaries", () => {
  it("rejects a malformed project response before UI state receives it", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ project: { name: "missing fields" }, path: "/tmp", revision: null }),
        ),
    );
    await expect(api("/api/project", projectResponseSchema.parse)).rejects.toThrow("Invalid input");
  });

  it("rejects malformed Codex identities and message envelopes", () => {
    expect(() => parseCodexMessage('{"id":{},"method":"turn/completed"}')).toThrow("Invalid input");
    expect(parseCodexMessage('{"id":7,"result":{"ok":true}}').id).toBe(7);
  });
});
