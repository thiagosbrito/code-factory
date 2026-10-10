// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/ui/app/App.js";
import { ErrorBoundary } from "../src/ui/app/ErrorBoundary.js";
import type { ProjectConfig } from "../src/runtime/project.js";
import type { AgentConnection } from "../src/adapters/contract.js";
import { trustState } from "./fixtures/trust.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function runtime(initial: ProjectConfig | null = null) {
  let project = initial;
  let revision = initial ? "saved" : null;
  let failNextSave = false;
  let failAgents = false;
  let agents: AgentConnection[] = [
    {
      provider: "codex",
      executable: "/bin/codex",
      installation: "detected",
      authentication: "unknown",
      capabilities: {
        streaming: "unknown",
        steering: "unknown",
        resume: "unknown",
        pause: "unsupported",
        waitingInput: "unknown",
      },
    },
  ];
  let connected: AgentConnection | null = null;
  const requests: { path: string; method: string }[] = [];
  vi.stubGlobal("fetch", async (input: string, options?: RequestInit) => {
    const path = String(input);
    const method = options?.method ?? "GET";
    requests.push({ path, method });
    let status = 200;
    let body: unknown;
    if (path === "/api/project" && method === "GET") {
      body = { project, path: "/canonical/project", revision, trust: trustState() };
    } else if (path === "/api/factory" && method === "GET") {
      body = { loops: 0, runs: 0 };
    } else if (path === "/api/loops" && method === "GET") {
      body = { loops: [] };
    } else if (path === "/api/loops/published" && method === "GET") {
      body = { loops: [] };
    } else if (path === "/api/runs" && method === "GET") {
      body = { runs: [] };
    } else if (path === "/api/tracker" && method === "GET") {
      body = { configured: false };
    } else if (path === "/api/agents" && method === "GET") {
      if (failAgents) {
        status = 503;
        body = { error: "Agent discovery unavailable" };
      } else body = { agents };
    } else if (path === "/api/agents/connect" && method === "POST") {
      if (!connected) {
        status = 422;
        body = { error: "Connection handshake failed" };
      } else {
        agents = agents.map((item) => (item.provider === connected?.provider ? connected! : item));
        body = { connection: connected };
      }
    } else if (path === "/api/project/setup" && method === "PUT") {
      if (failNextSave) {
        failNextSave = false;
        status = 403;
        body = { error: "Cannot save project configuration. Check write permissions." };
      } else {
        const request = JSON.parse(String(options?.body)) as {
          name: string;
          defaultBinding?: ProjectConfig["defaultBinding"];
        };
        project = {
          schemaVersion: 1,
          name: request.name,
          defaultBinding:
            request.defaultBinding === undefined
              ? (project?.defaultBinding ?? null)
              : request.defaultBinding,
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
    setAgents: (items: AgentConnection[]) => (agents = items),
    setConnection: (item: AgentConnection) => (connected = item),
    getProject: () => project,
  };
}

describe("automatic agent connection", () => {
  const codexConnection: AgentConnection = {
    provider: "codex",
    executable: "/bin/codex",
    installation: "detected",
    authentication: "authenticated",
    identity: "Codex CLI",
    version: "0.160.0",
    protocol: "Codex app-server JSON-RPC over stdio",
    capabilities: {
      streaming: "unknown",
      steering: "unknown",
      resume: "unknown",
      pause: "unsupported",
      waitingInput: "unknown",
    },
    models: [],
  };
  const connects = (local: ReturnType<typeof runtime>) =>
    local.requests.filter((item) => item.path === "/api/agents/connect");

  it("connects a chosen agent after a short pause, without pressing Verify", async () => {
    const local = runtime();
    local.setConnection(codexConnection);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Codex.*Executable detected/ }));
    expect(screen.getByRole("status").textContent).toContain("Connecting in a moment");
    expect(connects(local)).toHaveLength(0);
    expect(await screen.findByText(/Codex CLI 0.160.0 · Connected/)).toBeTruthy();
    expect(connects(local)).toHaveLength(1);
  });

  it("does not connect an agent the user moved away from within the pause", async () => {
    const local = runtime();
    local.setConnection(codexConnection);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Codex.*Executable detected/ }));
    await user.click(screen.getByRole("button", { name: /No default agent/ }));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(connects(local)).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("first-use UI", () => {
  it("uses explicit verification and keyboard selection, then clears incompatible draft models", async () => {
    const local = runtime();
    const base: AgentConnection = {
      provider: "codex",
      executable: "/bin/codex",
      installation: "detected",
      authentication: "unknown",
      capabilities: {
        streaming: "unknown",
        steering: "unknown",
        resume: "unknown",
        pause: "unsupported",
        waitingInput: "unknown",
      },
    };
    local.setAgents([
      base,
      ...(["cursor", "kiro", "claude-code"] as const).map((provider) => ({
        ...base,
        provider,
        executable: null,
        installation: "missing" as const,
      })),
      { ...base, provider: "custom", executable: null, installation: "missing" },
    ]);
    local.setConnection({
      ...base,
      identity: "Codex CLI",
      version: "0.160.0",
      protocol: "Codex app-server JSON-RPC over stdio",
      authentication: "authenticated",
      models: [{ id: "model-a", displayName: "Model A", efforts: ["low", "high"] }],
    });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Connect your first project" })).toBeTruthy();
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(local.requests.filter((item) => item.path === "/api/agents/connect")).toHaveLength(0);
    const codex = screen.getByRole("button", { name: /Codex.*Executable detected/ });
    // Setup moves focus to the name field on mount; wait for that so it cannot steal the focus.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Project name" })),
    );
    codex.focus();
    await user.keyboard("{Enter}");
    expect(codex.getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Verify connection" }));
    expect(await screen.findByText(/Codex CLI 0.160.0 · Connected/)).toBeTruthy();
    expect(screen.getByRole("option", { name: "Model A" })).toBeTruthy();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Project default model" }),
      "model-a",
    );
    fireEvent.change(screen.getByRole("slider", { name: "Project default effort" }), {
      target: { value: "2" },
    });
    const cursor = screen.getByRole("button", { name: /Cursor.*Not detected/ });
    cursor.focus();
    await user.keyboard("{Enter}");
    expect(cursor.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Project default model" })).toHaveProperty(
      "value",
      "agent-default",
    );
    expect(screen.queryByRole("slider", { name: "Project default effort" })).toBeNull();
    await user.click(codex);
    await user.type(screen.getByRole("textbox", { name: "Project name" }), "Verified project");
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(await screen.findByRole("heading", { name: "No runs yet" })).toBeTruthy();
    expect(local.getProject()?.defaultBinding).toEqual({
      provider: "codex",
      model: "agent-default",
    });
    expect(local.requests.filter((item) => item.path === "/api/agents/connect")).toHaveLength(1);
  });

  it("verifies Claude Code and saves one of its models and efforts as the default", async () => {
    const local = runtime();
    const claude: AgentConnection = {
      provider: "claude-code",
      executable: "/bin/claude",
      installation: "detected",
      authentication: "unknown",
      capabilities: {
        streaming: "unknown",
        steering: "unknown",
        resume: "unknown",
        pause: "unknown",
        waitingInput: "unknown",
      },
    };
    local.setAgents([claude]);
    local.setConnection({
      ...claude,
      identity: "Claude Code",
      version: "2.1.295",
      protocol: "claude-code-stream-json",
      authentication: "authenticated",
      models: [{ id: "opus", displayName: "Opus (latest)", efforts: ["low", "max"] }],
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: /Claude Code.*Detected; verification required/ }),
    );
    await user.click(screen.getByRole("button", { name: "Verify connection" }));
    expect(await screen.findByText(/Claude Code 2.1.295 · Connected/)).toBeTruthy();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Project default model" }),
      "opus",
    );
    fireEvent.change(screen.getByRole("slider", { name: "Project default effort" }), {
      target: { value: "2" },
    });
    await user.type(screen.getByRole("textbox", { name: "Project name" }), "Claude project");
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(await screen.findByRole("heading", { name: "No runs yet" })).toBeTruthy();
    expect(local.getProject()?.defaultBinding).toEqual({
      provider: "claude-code",
      model: "opus",
      effort: "max",
    });
  });

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
    expect(screen.getByRole("heading", { name: "Implement → Review → Validate" })).toBeTruthy();
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
