// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseLoop, type LoopDefinition } from "../src/domain/loop.js";
import { exportPortableLoop } from "../src/domain/loop-portable.js";
import { type AgentConnection } from "../src/adapters/contract.js";
import { Loops } from "../src/ui/features/loops/Loops.js";
import { draft, project } from "./support/loops-ui.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("loops library UI", () => {
  it("stays blank until a starter is chosen and saves the full staged starter as a draft", async () => {
    const user = userEvent.setup();
    const requests: { path: string; method: string; body?: LoopDefinition }[] = [];
    vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
      const method = options?.method ?? "GET";
      const body = options?.body ? (JSON.parse(String(options.body)) as LoopDefinition) : undefined;
      requests.push({ path, method, ...(body ? { body } : {}) });
      if (path === "/api/loops" && method === "GET") return Response.json({ loops: [] });
      if (path.endsWith("/draft") && method === "PUT" && body) return Response.json({ loop: body });
      throw new Error(`Unexpected ${method} ${path}`);
    });
    render(<Loops project={project} agents={[]} />);
    expect(await screen.findByRole("heading", { name: "No user loops yet" })).toBeTruthy();
    expect(requests).toEqual([{ path: "/api/loops", method: "GET" }]);
    await user.click(screen.getByRole("button", { name: "Use starter template" }));
    const chooser = screen.getByLabelText("Starter templates");
    expect(
      within(chooser).getByRole("heading", { name: /Implement.*Review.*Validate/ }),
    ).toBeTruthy();
    await user.click(within(chooser).getAllByRole("button", { name: "Create draft" })[1]!);
    await waitFor(() => expect(requests.some((request) => request.method === "PUT")).toBe(true));
    const saved = requests.find((request) => request.method === "PUT")!.body!;
    expect(saved.status).toBe("draft");
    expect(saved.steps).toHaveLength(18);
    expect(saved.steps.filter((step) => step.stage === "review")).toHaveLength(6);
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("validates a portable import before an explicit confirmation saves a new draft", async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
      const method = options?.method ?? "GET";
      requests.push(`${method} ${path}`);
      if (path === "/api/loops" && method === "GET") return Response.json({ loops: [] });
      if (path.endsWith("/draft") && method === "PUT")
        return Response.json({ loop: JSON.parse(String(options?.body)) });
      throw new Error(`Unexpected ${method} ${path}`);
    });
    render(<Loops project={project} agents={[]} />);
    await screen.findByRole("heading", { name: "No user loops yet" });
    await user.click(screen.getByRole("button", { name: "Import JSON" }));
    const input = screen.getByRole("textbox", { name: "Paste a portable loop document" });
    fireEvent.change(input, { target: { value: "{" } });
    await user.click(screen.getByRole("button", { name: "Validate import" }));
    expect(screen.getByRole("alert").textContent).toMatch(/JSON:/);
    expect(requests).toEqual(["GET /api/loops"]);
    fireEvent.change(input, { target: { value: exportPortableLoop(draft()) } });
    await user.click(screen.getByRole("button", { name: "Validate import" }));
    expect(screen.getByText(/Valid draft with 2 steps/)).toBeTruthy();
    expect(requests).toEqual(["GET /api/loops"]);
    await user.click(screen.getByRole("button", { name: "Confirm import: Sample" }));
    await waitFor(() => expect(requests.some((request) => request.startsWith("PUT "))).toBe(true));
  });

  it("reports a newly published loop to the factory run intake", async () => {
    const user = userEvent.setup();
    const agent: AgentConnection = {
      provider: "codex",
      executable: "/bin/codex",
      installation: "detected",
      authentication: "authenticated",
      protocol: "app-server",
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
    const published = parseLoop({ ...draft(), status: "published" });
    const onPublished = vi.fn<(loop: LoopDefinition) => void>();
    vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
      if (path === "/api/loops")
        return Response.json({ loops: [{ id: "sample", draft: draft(), published: null }] });
      if (path === "/api/loops/sample/draft" && options?.method === "PUT")
        return Response.json({ loop: draft() });
      if (path === "/api/loops/sample/publish" && options?.method === "POST")
        return Response.json({ loop: published });
      throw new Error(`Unexpected ${options?.method ?? "GET"} ${path}`);
    });
    render(
      <Loops
        project={{
          ...project,
          project: {
            ...project.project!,
            defaultBinding: { provider: "codex", model: "agent-default" },
          },
        }}
        agents={[agent]}
        onPublished={onPublished}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Edit draft" }));
    await user.click(screen.getByRole("button", { name: "Publish v1" }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith(published));
  });

  it("shows saved draft and published content separately", async () => {
    const published = parseLoop({ ...draft(), name: "Published plan", status: "published" });
    vi.stubGlobal("fetch", async () =>
      Response.json({ loops: [{ id: "sample", draft: draft(), published, versions: [1] }] }),
    );
    render(<Loops project={project} agents={[]} />);
    expect(await screen.findByRole("heading", { name: "Published plan" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sample" })).toBeTruthy();
    expect(screen.getByText("Published v1")).toBeTruthy();
  });
});
