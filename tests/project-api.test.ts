// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { api, runtimeApiPath } from "../src/ui/shared/project-api.js";

afterEach(() => vi.unstubAllGlobals());

it("keeps ordinary runtime paths and their query strings unchanged", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  expect(runtimeApiPath("/api/runs")).toBe("/api/runs");
  const withQuery = `/api/runs/${id}/diff?path=${encodeURIComponent("src/it's a b.ts")}`;
  expect(runtimeApiPath(withQuery)).toBe(withQuery);
});

it.each([
  "/api/loops/../../etc/passwd/draft",
  "/api/loops/%2e%2e/%2e%2e/secret",
  "//evil.example/api/runs",
  "https://evil.example/api/runs",
  "/apix/runs",
  "/runs",
  "api/../x",
  "/api/loops/..%2f..%2fsecret/draft",
  "/api/loops/a%5cb/draft",
  "/api//runs",
  "/api/",
])("refuses %s, which would leave the runtime API", (path) => {
  expect(() => runtimeApiPath(path)).toThrow(/outside the runtime API/);
});

it("does not send a request for a refused path", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  await expect(api("/api/loops/../../x", (value) => value)).rejects.toThrow(/outside/);
  expect(fetchMock).not.toHaveBeenCalled();
});
