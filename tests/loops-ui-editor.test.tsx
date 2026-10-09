// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseLoop, type LoopDefinition } from "../src/domain/loop.js";
import { type AgentConnection } from "../src/adapters/contract.js";
import { Loops } from "../src/ui/features/loops/Loops.js";
import { setParallelGroup } from "../src/ui/features/loops/loop-editor-model.js";
import { draft, project } from "./support/loops-ui.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("loops library UI", () => {
  it("restores drawer focus and offers a keyboard semantic move with undo and redo", async () => {
    const user = userEvent.setup();
    let stored = draft();
    const requests: { method: string; body?: LoopDefinition }[] = [];
    vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
      const method = options?.method ?? "GET";
      requests.push({
        method,
        ...(options?.body ? { body: JSON.parse(String(options.body)) as LoopDefinition } : {}),
      });
      if (path === "/api/loops" && method === "GET")
        return Response.json({ loops: [{ id: "sample", draft: stored, published: null }] });
      if (path === "/api/loops/sample/draft" && method === "PUT") {
        stored = JSON.parse(String(options?.body)) as LoopDefinition;
        return Response.json({ loop: stored });
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });
    render(<Loops project={project} agents={[]} />);
    await user.click(await screen.findByRole("button", { name: "Edit draft" }));
    const build = screen.getByRole("button", { name: "Build" });
    build.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Step configuration" })).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: "Title" })).toBe(
      document.activeElement,
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(build).toBe(document.activeElement));
    screen.getByRole("radio", { name: "Move Review" }).focus();
    await user.keyboard(" ");
    expect((screen.getByRole("radio", { name: "Move Review" }) as HTMLInputElement).checked).toBe(
      true,
    );
    screen.getByRole("button", { name: "before Build" }).focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(stored.dependencies).toEqual([{ from: "review", to: "build" }]));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(stored.dependencies).toEqual([{ from: "build", to: "review" }]));
    await user.click(screen.getByRole("button", { name: "Redo" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(stored.dependencies).toEqual([{ from: "review", to: "build" }]));
    expect(requests.filter((item) => item.method === "PUT")).toHaveLength(3);
  });

  it("blocks publication of an unbound definition before sending a publish request", async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (path: string) => {
      paths.push(path);
      if (path === "/api/loops")
        return Response.json({ loops: [{ id: "sample", draft: draft(), published: null }] });
      if (path === "/api/native/formats") return Response.json({ formats: [] });
      throw new Error(`Unexpected ${path}`);
    });
    render(<Loops project={project} agents={[]} />);
    await user.click(await screen.findByRole("button", { name: "Edit draft" }));
    await user.click(screen.getByRole("button", { name: "Publish v1" }));
    expect(screen.getByRole("alert").textContent).toMatch(/project default or step binding/);
    expect(paths).toEqual(["/api/loops", "/api/native/formats"]);
  });

  it("shows an unsupported project model and blocks publication", async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
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
    vi.stubGlobal("fetch", async (path: string) => {
      paths.push(path);
      if (path === "/api/loops")
        return Response.json({ loops: [{ id: "sample", draft: draft(), published: null }] });
      if (path === "/api/native/formats") return Response.json({ formats: [] });
      throw new Error(`Unexpected ${path}`);
    });
    render(
      <Loops
        project={{
          ...project,
          project: {
            ...project.project!,
            defaultBinding: { provider: "codex", model: "old-model" },
          },
        }}
        agents={[agent]}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Edit draft" }));
    await user.click(screen.getByRole("button", { name: "Publish v1" }));
    expect(screen.getByRole("alert").textContent).toMatch(/old-model.*unavailable/);
    expect(paths).toEqual(["/api/loops", "/api/native/formats"]);
  });

  it("shows semantic group membership on the board and restores focus when undo removes an open step", async () => {
    const user = userEvent.setup();
    const grouped = setParallelGroup(
      parseLoop({ ...draft(), dependencies: [] }),
      ["build", "review"],
      "Reviews",
    );
    vi.stubGlobal("fetch", async (path: string) => {
      if (path === "/api/loops")
        return Response.json({ loops: [{ id: "sample", draft: grouped, published: null }] });
      throw new Error(`Unexpected ${path}`);
    });
    render(<Loops project={project} agents={[]} />);
    await user.click(await screen.findByRole("button", { name: "Edit draft" }));
    expect(screen.getAllByText("agent · parallel: Reviews")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "+ Agent step" }));
    await user.click(screen.getByRole("button", { name: "New agent step" }));
    expect(screen.getByRole("dialog", { name: "Step configuration" })).toBeTruthy();
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "← Loops" })).toBe(document.activeElement),
    );
  });
});
