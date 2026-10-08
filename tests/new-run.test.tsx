// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createLoopDraft, parseLoop } from "../src/domain/loop.js";
import type { AgentConnection } from "../src/adapters/contract.js";
import { NewRunDialog } from "../src/ui/NewRunDialog.js";

const loop = parseLoop({
  ...createLoopDraft("saved", "Saved loop"),
  status: "published",
  steps: [{ id: "build", name: "Build", kind: "agent", role: "builder", instruction: "Build" }],
});
const secondLoop = parseLoop({ ...loop, id: "second", name: "Second loop", version: 2 });
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
const binding = { provider: "codex" as const, model: "agent-default" };
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});
function view(
  options: {
    loops?: (typeof loop)[];
    tracker?: boolean;
    agents?: AgentConnection[];
    onStarted?: (id: string) => void;
  } = {},
) {
  return render(
    <NewRunDialog
      open
      onOpenChange={() => {}}
      projectName="Real project"
      loops={options.loops ?? [loop]}
      trackerConfigured={options.tracker ?? true}
      canStart
      agents={options.agents ?? [agent]}
      defaultBinding={binding}
      onStarted={options.onStarted ?? (() => {})}
    />,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("new run dialog", () => {
  it("submits description-only with the selected published version and real returned run ID", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", async (_path: string, options: RequestInit) => {
      requests.push(JSON.parse(String(options.body)));
      return new Response(JSON.stringify({ runId: "11111111-1111-4111-8111-111111111111" }), {
        status: 201,
      });
    });
    const started = vi.fn<(id: string) => void>();
    view({ tracker: false, onStarted: started });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Task description/), "My task");
    await user.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() =>
      expect(started.mock.calls[0]?.[0]).toBe("11111111-1111-4111-8111-111111111111"),
    );
    expect(requests).toMatchObject([
      { project: "selected", loopId: "saved", loopVersion: 1, description: "My task" },
    ]);
  });

  it("blocks missing loops and unverified agent bindings", () => {
    const { rerender } = view({ loops: [] });
    expect(screen.getByRole("button", { name: "Start run" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/No published loop/)).toBeTruthy();
    rerender(
      <NewRunDialog
        open
        onOpenChange={() => {}}
        projectName="Real project"
        loops={[loop]}
        trackerConfigured
        canStart
        agents={[{ ...agent, authentication: "unknown" }]}
        defaultBinding={binding}
        onStarted={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Start run" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/unavailable until its connection is verified/)).toBeTruthy();
  });

  it("focuses ticket intake on open and closes with Escape", async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(
      <NewRunDialog
        open
        onOpenChange={onOpenChange}
        projectName="Real project"
        loops={[loop]}
        trackerConfigured
        canStart
        agents={[agent]}
        defaultBinding={binding}
        onStarted={() => {}}
      />,
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText(/Ticket number/)),
    );
    await userEvent.setup().keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("submits the selected persisted loop version and a retrieved ticket", async () => {
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_path: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body)) as Record<string, unknown>;
      requests.push(body);
      return new Response(
        JSON.stringify(
          body.id
            ? {
                ticket: {
                  id: "THI-9",
                  title: "Issue title",
                  summary: "Issue details",
                  attachments: [{ title: "spec", url: "https://example.com/spec" }],
                },
              }
            : { runId: "33333333-3333-4333-8333-333333333333" },
        ),
        { status: body.id ? 200 : 201 },
      );
    });
    const started = vi.fn<(id: string) => void>();
    view({ loops: [loop, secondLoop], onStarted: started });
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Published loop" }));
    await user.click(screen.getByRole("option", { name: "Second loop · v2" }));
    await user.type(screen.getByLabelText(/Ticket number/), "THI-9");
    await user.click(screen.getByRole("button", { name: "Retrieve" }));
    await waitFor(() => expect(screen.getByText(/Issue title/)).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() =>
      expect(started.mock.calls[0]?.[0]).toBe("33333333-3333-4333-8333-333333333333"),
    );
    expect(requests[1]).toMatchObject({
      loopId: "second",
      loopVersion: 2,
      description: "",
      ticketId: "THI-9",
    });
  });

  it("starts an issue run through the agent when no direct tracker is configured", async () => {
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_path: string, options: RequestInit) => {
      requests.push(JSON.parse(String(options.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ runId: "44444444-4444-4444-8444-444444444444" }), {
        status: 201,
      });
    });
    const started = vi.fn<(id: string) => void>();
    view({ tracker: false, onStarted: started });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Ticket number/), "PROJ-123");
    expect(
      screen.getByText(
        /selected agent will read this issue through its configured issue tracker MCP/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retrieve" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() =>
      expect(started.mock.calls[0]?.[0]).toBe("44444444-4444-4444-8444-444444444444"),
    );
    expect(requests).toMatchObject([{ description: "", ticketId: "PROJ-123" }]);
  });

  it("names the run branch after the ticket until edited and offers a free name when taken", async () => {
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_path: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body)) as Record<string, unknown>;
      requests.push(body);
      return body.branch === "PROJ-9"
        ? new Response(
            JSON.stringify({
              error:
                "Branch PROJ-9 already exists. Choose another name; Code Factory never reuses or overwrites a branch.",
              suggestedName: "PROJ-9-2",
            }),
            { status: 409 },
          )
        : new Response(JSON.stringify({ runId: "55555555-5555-4555-8555-555555555555" }), {
            status: 201,
          });
    });
    const started = vi.fn<(id: string) => void>();
    view({ tracker: false, onStarted: started });
    const user = userEvent.setup();
    const branch = screen.getByLabelText("Branch") as HTMLInputElement;
    expect(branch.value).toBe("");
    expect(screen.getByText(/switches your checkout to it/)).toBeTruthy();
    await user.type(screen.getByLabelText(/Ticket number/), "proj-9");
    expect(branch.value).toBe("PROJ-9");
    await user.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already exists"));
    await user.click(screen.getByRole("button", { name: "Use PROJ-9-2" }));
    expect(branch.value).toBe("PROJ-9-2");
    // An edited name no longer follows the ticket, and invalid names never reach the API.
    await user.clear(branch);
    await user.type(branch, "main");
    expect(screen.getByText("main is a protected branch name.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Start run" }));
    expect(requests).toHaveLength(1);
    await user.clear(branch);
    await user.type(branch, "feature/proj-9");
    await user.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() =>
      expect(started.mock.calls[0]?.[0]).toBe("55555555-5555-4555-8555-555555555555"),
    );
    expect(requests.at(-1)).toMatchObject({ ticketId: "PROJ-9", branch: "feature/proj-9" });
  });

  it.each([
    [401, "Tracker authentication failed"],
    [503, "Ticket retrieval failed"],
  ])("shows retrieval failure %i", async (status, message) => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ error: "Unavailable" }), { status }),
    );
    view();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Ticket number/), "THI-9");
    await user.click(screen.getByRole("button", { name: "Retrieve" }));
    await waitFor(() => expect(screen.getByText(new RegExp(message))).toBeTruthy());
    expect(screen.getByRole("button", { name: "Start run" }).hasAttribute("disabled")).toBe(true);
  });

  it("ignores stale retrieval, blocks failed tickets, and allows clearing for description-only", async () => {
    let resolveFirst!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((_path: string, options: RequestInit) => {
        const body = JSON.parse(String(options.body)) as { id?: string; ticketId?: string };
        if (body.id === "THI-1")
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          });
        if (body.id === "THI-2")
          return Promise.resolve(
            new Response(JSON.stringify({ error: "Ticket not found" }), { status: 404 }),
          );
        return Promise.resolve(
          new Response(JSON.stringify({ runId: "22222222-2222-4222-8222-222222222222" }), {
            status: 201,
          }),
        );
      }),
    );
    const started = vi.fn<(id: string) => void>();
    view({ onStarted: started });
    const user = userEvent.setup();
    const ticket = screen.getByLabelText(/Ticket number/);
    await user.type(ticket, "THI-1");
    await user.click(screen.getByRole("button", { name: "Retrieve" }));
    await user.clear(ticket);
    await user.type(ticket, "THI-2");
    await user.click(screen.getByRole("button", { name: "Retrieve" }));
    await waitFor(() => expect(screen.getByText(/Ticket not found/)).toBeTruthy());
    resolveFirst(
      new Response(
        JSON.stringify({
          ticket: { id: "THI-1", title: "Stale", summary: "stale", attachments: [] },
        }),
      ),
    );
    await Promise.resolve();
    expect(screen.queryByText(/Stale/)).toBeNull();
    expect(screen.getByRole("button", { name: "Start run" }).hasAttribute("disabled")).toBe(true);
    await user.clear(ticket);
    await user.type(screen.getByLabelText(/Task description/), "Use description");
    await user.click(screen.getByRole("button", { name: "Start run" }));
    await waitFor(() =>
      expect(started.mock.calls[0]?.[0]).toBe("22222222-2222-4222-8222-222222222222"),
    );
  });
});
