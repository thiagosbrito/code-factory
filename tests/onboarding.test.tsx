// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/ui/App.js";
import { ErrorBoundary } from "../src/ui/ErrorBoundary.js";
import type { ProjectConfig } from "../src/runtime/project.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function runtime(initial: ProjectConfig | null = null) {
  let project = initial;
  let revision = initial ? "saved" : null;
  let failNextSave = false;
  let failAgents = false;
  const requests: { path: string; method: string }[] = [];
  vi.stubGlobal("fetch", async (input: string, options?: RequestInit) => {
    const path = String(input);
    const method = options?.method ?? "GET";
    requests.push({ path, method });
    let status = 200;
    let body: unknown;
    if (path === "/api/project" && method === "GET") {
      body = { project, path: "/canonical/project", revision };
    } else if (path === "/api/factory" && method === "GET") {
      body = { loops: 0, runs: 0 };
    } else if (path === "/api/agents" && method === "GET") {
      if (failAgents) {
        status = 503;
        body = { error: "Agent discovery unavailable" };
      } else
        body = {
          agents: [
            {
              provider: "codex",
              executable: "/bin/codex",
              installation: "detected",
              authentication: "unknown",
              capabilities: { streaming: "unknown", steering: "unknown", resume: "unknown" },
            },
          ],
        };
    } else if (path === "/api/project/setup" && method === "PUT") {
      if (failNextSave) {
        failNextSave = false;
        status = 403;
        body = { error: "Cannot save project configuration. Check write permissions." };
      } else {
        const request = JSON.parse(String(options?.body)) as { name: string };
        project = {
          schemaVersion: 1,
          name: request.name,
          defaultBinding: project?.defaultBinding ?? null,
        };
        revision = "updated";
        body = { project, revision };
      }
    } else {
      status = 404;
      body = { error: "Unexpected request" };
    }
    return new Response(JSON.stringify(body), { status });
  });
  return {
    requests,
    failSave: () => (failNextSave = true),
    setAgentFailure: (failed: boolean) => (failAgents = failed),
    getProject: () => project,
  };
}

describe("first-use UI", () => {
  it("recovers from a render error through the application error boundary", async () => {
    let failing = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    function View() {
      if (failing) throw new Error("Could not render project view.");
      return <h1>Recovered project</h1>;
    }
    try {
      const user = userEvent.setup();
      render(
        <ErrorBoundary>
          <View />
        </ErrorBoundary>,
      );
      expect(screen.getByRole("alert").textContent).toContain("Could not render project view.");
      failing = false;
      await user.click(screen.getByRole("button", { name: "Retry" }));
      expect(screen.getByRole("heading", { name: "Recovered project" })).toBeTruthy();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("validates the name, reports a failed save, retries with Enter, and keeps demo separate", async () => {
    const local = runtime();
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Connect your first project" })).toBeTruthy();
    const name = screen.getByRole("textbox", { name: "Project name" });
    expect(document.activeElement).toBe(name);
    expect(screen.getByLabelText("Canonical project path").textContent).toContain(
      "/canonical/project",
    );
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(screen.getByRole("alert").textContent).toContain("Enter a project name");
    expect(document.activeElement).toBe(name);
    await user.type(name, "My project");
    local.failSave();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Cannot save project configuration. Check write permissions.",
    );
    expect(local.getProject()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(await screen.findByRole("heading", { name: "No runs yet" })).toBeTruthy();
    expect(local.getProject()?.name).toBe("My project");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Runs" })),
    );
    screen.getByRole("button", { name: "Runs" }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Loops" }));
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "No user loops yet" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use starter template" }));
    expect(screen.getByText(/Starter templates become available/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open demo factory" }));
    expect(screen.getByText(/Sample loops/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Exit demo" }));
    expect(screen.getByRole("heading", { name: "No user loops yet" })).toBeTruthy();
    expect(local.requests.filter((request) => request.method === "PUT")).toHaveLength(2);
  });

  it("resumes a saved project and edits setup without treating detection as verification", async () => {
    const local = runtime({
      schemaVersion: 1,
      name: "Existing",
      defaultBinding: { provider: "codex", model: "saved-model" },
    });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "No runs yet" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Edit project setup" }));
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveProperty(
      "value",
      "Existing",
    );
    expect(screen.getByText("Detected; verification required")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Project default model" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("option", { name: /saved-model/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit project setup" }));
    await user.clear(screen.getByRole("textbox", { name: "Project name" }));
    await user.type(screen.getByRole("textbox", { name: "Project name" }), "Renamed");
    await user.click(screen.getByRole("button", { name: "Save project" }));
    await waitFor(() => expect(screen.getAllByText("Renamed")).toHaveLength(2));
    expect(local.getProject()?.defaultBinding?.model).toBe("saved-model");
    cleanup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "No runs yet" })).toBeTruthy();
    expect(screen.getByText("Renamed")).toBeTruthy();
  });

  it("keeps project setup available when optional agent discovery fails", async () => {
    const local = runtime();
    local.setAgentFailure(true);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Connect your first project" })).toBeTruthy();
    expect(screen.getByText(/Agent discovery is unavailable/)).toBeTruthy();
    local.setAgentFailure(false);
    await user.click(screen.getByRole("button", { name: "Recheck agents" }));
    expect(await screen.findByText("Detected; verification required")).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Project name" }), "Offline setup");
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(await screen.findByRole("heading", { name: "No runs yet" })).toBeTruthy();
  });
});
