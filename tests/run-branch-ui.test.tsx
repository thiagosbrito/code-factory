// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvidenceSummary } from "../src/domain/acceptance.js";
import { parseLoop } from "../src/domain/loop.js";
import {
  createRunRecord,
  createRunSnapshot,
  finishAttempt,
  runRecordSchema,
  startAttempt,
  type RunRecord,
} from "../src/domain/run.js";
import { claimStep, completeStep } from "../src/domain/scheduler.js";
import { REMOVAL_DIRTY, type RunWorkspace } from "../src/domain/run-branch.js";
import { issueBlockedSentinel } from "../src/domain/ticket.js";
import { RunDetail } from "../src/ui/RunDetail.js";
import { RunWorkspacePanel } from "../src/ui/RunWorkspacePanel.js";
import { ToolGrantDialog, toolGrantText } from "../src/ui/ToolGrantDialog.js";
import { ToolPermissionsSection } from "../src/ui/ToolPermissionsSection.js";
import { useFactoryRuns } from "../src/ui/useFactoryRuns.js";
import type { ProjectResponse, SavedProjectResponse } from "../src/ui/project-api.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  location.hash = "";
});

const summary = (acceptance: EvidenceSummary["acceptance"]): EvidenceSummary => ({
  validation: "passed",
  acceptance,
  requirements: [],
  findings: [],
  gaps: [],
  files: [],
  artifacts: [],
  signature: "sig",
});
const workspace = (overrides: Partial<RunWorkspace> = {}): RunWorkspace => ({
  kind: "worktree",
  path: "/work/repo-code-factory/run-1",
  branch: "code-factory/abcd1234",
  state: "present",
  dirty: false,
  removalBlocked: false,
  commits: [{ sha: "a".repeat(40), subject: "BMAP-1190: Implement (implement) attempt 1" }],
  promotion: null,
  defaultBranchName: "BMAP-1190",
  setupConfigured: true,
  checkout: null,
  ...overrides,
});
const projectWorkspace = (
  checkout: Partial<NonNullable<RunWorkspace["checkout"]>> = {},
  overrides: Partial<RunWorkspace> = {},
): RunWorkspace =>
  workspace({
    kind: "project",
    path: "/work/repo",
    branch: "work/bmap",
    removalBlocked: null,
    checkout: {
      current: "work/bmap",
      onRunBranch: true,
      previousBranch: "main",
      previousRevision: "b".repeat(40),
      returnBlocker: null,
      ...checkout,
    },
    ...overrides,
  });
const panel = (props: Partial<Parameters<typeof RunWorkspacePanel>[0]> = {}) =>
  render(
    <RunWorkspacePanel
      workspace={workspace()}
      summary={summary("accepted")}
      connected
      busy={false}
      onPromote={async () => ({})}
      onRemove={async () => null}
      onReturn={async () => null}
      {...props}
    />,
  );

describe("run branch panel", () => {
  it("shows the branch and path and announces copy results", async () => {
    // user-event installs its own clipboard; observe the writes at that browser boundary.
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    panel();
    expect(screen.getByText("code-factory/abcd1234")).toBeTruthy();
    expect(screen.getByText("/work/repo-code-factory/run-1")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy branch" }));
    expect(writeText).toHaveBeenLastCalledWith("code-factory/abcd1234");
    expect(screen.getByRole("status").textContent).toBe("Branch name copied.");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy path" }));
    expect(writeText).toHaveBeenLastCalledWith("/work/repo-code-factory/run-1");
    await user.click(screen.getByRole("button", { name: "Copy open command" }));
    expect(writeText).toHaveBeenLastCalledWith("code -n '/work/repo-code-factory/run-1'");
    writeText.mockRejectedValueOnce(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "Copy branch" }));
    expect(screen.getByRole("status").textContent).toBe(
      "Copy failed. Select the text and copy it manually.",
    );
  });

  it("gates ticket-branch creation on acceptance and the promotion dirty rule only", () => {
    const { rerender } = panel({ summary: summary("pending") });
    const button = () => screen.getByRole("button", { name: "Create ticket branch" });
    expect(button().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Accept the evidence before creating a ticket branch.").id).toBe(
      button().getAttribute("aria-describedby"),
    );
    const props = {
      connected: true,
      busy: false,
      onPromote: async () => ({}),
      onRemove: async () => null,
      onReturn: async () => null,
    };
    rerender(
      <RunWorkspacePanel
        {...props}
        workspace={workspace({ removalBlocked: true })}
        summary={summary("accepted")}
      />,
    );
    expect(button().hasAttribute("disabled")).toBe(false);
    const remove = screen.getByRole("button", { name: "Remove worktree…" });
    expect(remove.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText(REMOVAL_DIRTY).id).toBe(remove.getAttribute("aria-describedby"));
    rerender(
      <RunWorkspacePanel
        {...props}
        workspace={workspace({ dirty: true })}
        summary={summary("accepted")}
      />,
    );
    expect(button().hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText(
        "The run's files have uncommitted changes, so the branch would not match the accepted candidate.",
      ),
    ).toBeTruthy();
  });

  it("pre-fills the ticket ID, offers a suggested name, and returns focus after creating", async () => {
    const onPromote = vi
      .fn<
        (name: string) => Promise<{ error: string; suggestedName?: string } | { warning?: string }>
      >()
      .mockResolvedValueOnce({
        error: "Branch BMAP-1190 already exists. Choose another name.",
        suggestedName: "BMAP-1190-2",
      })
      .mockResolvedValueOnce({});
    // Like useFactoryRuns.promote, refresh the workspace before resolving, so the trigger unmounts.
    const Stateful = () => {
      const [current, setCurrent] = useState(workspace());
      return (
        <RunWorkspacePanel
          workspace={current}
          summary={summary("accepted")}
          connected
          busy={false}
          onRemove={async () => null}
          onReturn={async () => null}
          onPromote={async (name) => {
            const result = await onPromote(name);
            if (!("error" in result))
              setCurrent(
                workspace({
                  promotion: {
                    branch: name,
                    commit: "b".repeat(40),
                    createdAt: "2026-10-07T12:00:00.000Z",
                  },
                }),
              );
            return result;
          }}
        />
      );
    };
    render(<Stateful />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Create ticket branch" });
    await user.click(trigger);
    const input = screen.getByRole("textbox", { name: "Branch name" });
    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe("BMAP-1190");
    await user.click(screen.getByRole("button", { name: "Create branch" }));
    expect(onPromote).toHaveBeenLastCalledWith("BMAP-1190");
    expect(screen.getByRole("alert").textContent).toContain("already exists");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Use BMAP-1190-2" }));
    await user.click(screen.getByRole("button", { name: "Create branch" }));
    expect(onPromote).toHaveBeenLastCalledWith("BMAP-1190-2");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("Created branch BMAP-1190-2.");
    expect(trigger.isConnected).toBe(false);
    const result = screen.getByText(/^Ticket branch/);
    expect(result.textContent).toBe("Ticket branch BMAP-1190-2 at bbbbbbb");
    await waitFor(() => expect(document.activeElement).toBe(result));
  });

  it("moves focus to Copy branch after removing the worktree", async () => {
    const Stateful = () => {
      const [current, setCurrent] = useState(workspace());
      return (
        <RunWorkspacePanel
          workspace={current}
          summary={summary("accepted")}
          connected
          busy={false}
          onPromote={async () => ({})}
          onReturn={async () => null}
          onRemove={async () => {
            setCurrent(workspace({ state: "removed" }));
            return null;
          }}
        />
      );
    };
    render(<Stateful />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove worktree…" }));
    await user.click(screen.getByRole("button", { name: "Remove worktree" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: "Remove worktree…" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Worktree removed. Branches are kept.");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Copy branch" })),
    );
  });

  it("selects the visible open command when copying it fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    panel();
    await user.click(screen.getByRole("button", { name: "Copy open command" }));
    expect(screen.getByRole("status").textContent).toBe(
      "Copy failed. Select the text and copy it manually.",
    );
    expect(window.getSelection()?.toString()).toBe("code -n '/work/repo-code-factory/run-1'");
  });

  it("requires a name for description-only runs", async () => {
    panel({ workspace: workspace({ defaultBranchName: "" }) });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create ticket branch" }));
    expect((screen.getByRole("textbox", { name: "Branch name" }) as HTMLInputElement).value).toBe(
      "",
    );
    const create = screen.getByRole("button", { name: "Create branch" });
    expect(create.hasAttribute("disabled")).toBe(true);
    await user.type(screen.getByRole("textbox", { name: "Branch name" }), "demo-run");
    expect(create.hasAttribute("disabled")).toBe(false);
  });

  it("shows an in-project run's checkout and switches back to the previous branch", async () => {
    const user = userEvent.setup();
    const onReturn = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce("Git refused to switch branches: would be overwritten")
      .mockResolvedValueOnce(null);
    panel({ workspace: projectWorkspace(), onReturn });
    expect(screen.getByText("Project")).toBeTruthy();
    expect(screen.getByText("/work/repo")).toBeTruthy();
    expect(
      screen.getByText("Your project checkout is on this branch (it was on main)."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove worktree…" })).toBeNull();
    expect(screen.queryByText(/No setup command is configured/)).toBeNull();
    const back = screen.getByRole("button", { name: "Back to main" });
    await user.click(back);
    expect(screen.getByRole("alert").textContent).toBe(
      "Git refused to switch branches: would be overwritten",
    );
    await user.click(back);
    expect(onReturn).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Switched the project back to main."),
    );
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Run branch" }));
  });

  it("explains why switching back or promoting is unavailable for an in-project run", () => {
    const { rerender } = panel({
      workspace: projectWorkspace({
        returnBlocker: "Finish or cancel the run before switching back to main.",
      }),
    });
    const back = screen.getByRole("button", { name: "Back to main" });
    expect(back.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Finish or cancel the run before switching back to main.").id).toBe(
      back.getAttribute("aria-describedby"),
    );
    rerender(
      <RunWorkspacePanel
        workspace={projectWorkspace({}, { branch: "BMAP-1190" })}
        summary={summary("accepted")}
        connected
        busy={false}
        onPromote={async () => ({})}
        onRemove={async () => null}
        onReturn={async () => null}
      />,
    );
    expect(screen.queryByRole("button", { name: "Create ticket branch" })).toBeNull();
    expect(
      screen.getByText(
        "The run branch already carries the ticket name, so there is nothing to promote.",
      ),
    ).toBeTruthy();
    rerender(
      <RunWorkspacePanel
        workspace={projectWorkspace({ current: "main", onRunBranch: false })}
        summary={summary("accepted")}
        connected
        busy={false}
        onPromote={async () => ({})}
        onRemove={async () => null}
        onReturn={async () => null}
      />,
    );
    expect(
      screen.getByText(
        "Your project checkout is now on main; this run's commits stay on work/bmap.",
      ),
    ).toBeTruthy();
    // Nothing to switch back from once the checkout left the run branch.
    expect(screen.queryByRole("button", { name: "Back to main" })).toBeNull();
  });

  it("shows the missing-dependency note only without a setup command", () => {
    panel({ workspace: workspace({ setupConfigured: false }) });
    expect(
      screen.getByText(/No setup command is configured, so dependencies may be missing/),
    ).toBeTruthy();
  });
});

const step = (id: string, stage: "implementation" | "review") => ({
  id,
  name: id === "quality" ? "Test quality" : id,
  kind: "agent" as const,
  stage,
  role: id,
  instruction: id,
});
const blockedRun = (): RunRecord => {
  const loop = parseLoop({
    schemaVersion: 2,
    id: "flow",
    name: "Flow",
    version: 1,
    status: "published",
    steps: [
      step("build", "implementation"),
      step("quality", "review"),
      step("adjudicate", "implementation"),
    ],
    dependencies: [
      { from: "build", to: "quality" },
      { from: "quality", to: "adjudicate" },
    ],
    groups: [],
    joins: [],
    decisions: [],
    policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 1 },
  });
  let run = createRunRecord(
    createRunSnapshot(loop, { description: "Task" }, { provider: "mock", model: "default" }),
  );
  run = completeStep(claimStep(run, "build", "c", "i"), "build", { status: "succeeded" });
  run = claimStep(run, "quality", "c", "i");
  const attemptId = run.steps.find((item) => item.stepId === "quality")?.attempts.at(-1)?.id ?? "";
  run = runRecordSchema.parse({
    ...run,
    revision: run.revision + 1,
    evidence: [
      ...run.evidence,
      {
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "quality",
        attemptId,
        createdAt: new Date().toISOString(),
        kind: "event",
        type: "lifecycle",
        title: "completed",
        detail: "blocked\nCannot run yarn test: shell refused.",
        state: "succeeded",
        sequence: 0,
      },
    ],
  });
  return completeStep(run, "quality", { status: "succeeded", outcome: "blocked" });
};

describe("stopped runs", () => {
  type Retry = (stepId: string, attemptId: string, focusTarget?: HTMLElement | null) => void;
  const detail = (run: RunRecord, onRetry = vi.fn<Retry>()) =>
    render(
      <RunDetail
        run={run}
        summary={null}
        accepting={false}
        onAccept={() => undefined}
        connected
        executing={false}
        onExecute={() => undefined}
        onCancel={() => undefined}
        onRetry={onRetry}
        onBack={() => undefined}
      />,
    );

  it("offers Cancel run next to Execute run for a pending run, which holds the project", async () => {
    const pending = createRunRecord(
      createRunSnapshot(
        parseLoop({
          schemaVersion: 2,
          id: "flow",
          name: "Flow",
          version: 1,
          status: "published",
          steps: [step("implement", "implementation")],
          dependencies: [],
          groups: [],
          joins: [],
          decisions: [],
          policy: {},
        }),
        { description: "Task" },
        { provider: "mock", model: "default" },
      ),
    );
    const onCancel = vi.fn<() => void>();
    render(
      <RunDetail
        run={pending}
        summary={null}
        accepting={false}
        onAccept={() => undefined}
        connected
        executing={false}
        onExecute={() => undefined}
        onCancel={onCancel}
        onRetry={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Execute run" })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel run" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders Not reached for pending steps, names the blocking review, and offers Retry", async () => {
    const run = blockedRun();
    expect(run.status).toBe("blocked");
    const onRetry = vi.fn<Retry>();
    detail(run, onRetry);
    const node = screen.getByRole("button", { name: /^adjudicate, Not reached/ });
    expect(within(node).getByText("Not reached").className).toContain("run-status-not-reached");
    const banner = screen.getByRole("region", { name: "Test quality blocked the run" });
    expect(within(banner).getByText(/Cannot run yarn test: shell refused\./)).toBeTruthy();
    await userEvent
      .setup()
      .click(within(banner).getByRole("button", { name: "Retry Test quality" }));
    const title = screen.getByRole("heading", { level: 2 });
    expect(onRetry).toHaveBeenCalledWith(
      "quality",
      run.steps.find((item) => item.stepId === "quality")?.attempts.at(-1)?.id,
      title,
    );
    // The banner unmounts once the run resumes, so focus moves to the run title, which stays.
    expect(document.activeElement).toBe(title);
  });

  it("shows only the tracker banner for a failed issue lookup", () => {
    const loop = parseLoop({
      schemaVersion: 2,
      id: "flow",
      name: "Flow",
      version: 1,
      status: "published",
      steps: [step("build", "implementation")],
      dependencies: [],
      groups: [],
      joins: [],
      decisions: [],
      policy: { maxAttemptsPerStep: 2 },
    });
    let run = createRunRecord(
      createRunSnapshot(
        loop,
        { description: "", ticketId: "PROJ-1" },
        { provider: "mock", model: "default" },
      ),
    );
    run = startAttempt(run, "build");
    const attemptId = run.steps[0]?.attempts[0]?.id ?? "";
    run = runRecordSchema.parse({
      ...finishAttempt(run, "build", "failed"),
      status: "failed",
      evidence: [
        {
          id: crypto.randomUUID(),
          runId: run.snapshot.id,
          stepId: "build",
          attemptId,
          createdAt: new Date().toISOString(),
          kind: "event",
          type: "lifecycle",
          title: "completed",
          detail: `${issueBlockedSentinel("PROJ-1")}.`,
          state: "failed",
          sequence: 0,
        },
      ],
    });
    detail(run);
    expect(
      screen.getByRole("region", { name: "Connect your issue tracker to continue" }),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: /failed$|blocked the run$/ })).toBeNull();
  });
});

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const kiroRun = (provider: "kiro" | "mock" = "kiro") =>
  createRunRecord(
    createRunSnapshot(
      parseLoop({
        schemaVersion: 2,
        id: "flow",
        name: "Flow",
        version: 1,
        status: "published",
        steps: [step("build", "implementation")],
        dependencies: [],
        groups: [],
        joins: [],
        decisions: [],
        policy: { maxAttemptsPerStep: 2 },
      }),
      { description: "Task" },
      { provider, model: "agent-default" },
    ),
  );
const projectConfig = { schemaVersion: 1 as const, name: "Demo", defaultBinding: null };

/** The gate as Factory wires it: one hook, one dialog, Execute as the focus target. */
const Harness = () => {
  const heading = useRef<HTMLHeadingElement>(null);
  const runs = useFactoryRuns(false);
  const run = runs.runs[0];
  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        Factory
      </h1>
      {run && <button onClick={() => void runs.execute(run.snapshot.id)}>Execute run</button>}
      <ToolGrantDialog
        mode="run"
        prompt={runs.toolGrantPrompt}
        onAnswer={(choice) => void runs.answerToolGrant(choice)}
        returnFocus={runs.toolGrantReturnFocus}
        fallbackFocus={heading}
      />
    </>
  );
};
const stubRuntime = (run: RunRecord, project: Record<string, unknown> = projectConfig) => {
  const calls: string[] = [];
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async (input, init) => {
      const path = String(input);
      calls.push(`${init?.method ?? "GET"} ${path}`);
      if (path === "/api/runs") return respond({ runs: [run] });
      if (path === "/api/loops/published") return respond({ loops: [] });
      if (path === "/api/tracker") return respond({ configured: false });
      if (path === "/api/project") return respond({ project, path: "/repo", revision: "r1" });
      if (path === "/api/project/tool-grants")
        return respond({
          project: {
            ...project,
            toolGrants: {
              kiro: { scope: ["execute_bash"], grantedAt: "2026-10-07T10:00:00.000Z" },
            },
          },
          revision: "r2",
        });
      if (path.endsWith("/execute")) return respond({ run }, 202);
      return respond({ error: "unexpected" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return calls;
};

describe("agent tool permission prompt", () => {
  it("asks once with the exact scope, focuses Cancel, and grants before executing", async () => {
    const calls = stubRuntime(kiroRun());
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Execute run" }));
    const dialog = await screen.findByRole("dialog", { name: toolGrantText.kiro.title });
    expect(within(dialog).getByText(toolGrantText.kiro.scope)).toBeTruthy();
    expect(within(dialog).getByText(toolGrantText.kiro.implication).textContent).toContain(
      "in any directory it chooses",
    );
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
    await user.click(within(dialog).getByRole("button", { name: "Allow and run" }));
    await waitFor(() => expect(calls.some((call) => call.endsWith("/execute"))).toBe(true));
    const grantIndex = calls.indexOf("POST /api/project/tool-grants");
    expect(grantIndex).toBeGreaterThan(-1);
    expect(grantIndex).toBeLessThan(calls.findIndex((call) => call.endsWith("/execute")));
  });

  it("cancels without executing and returns focus to Execute", async () => {
    const calls = stubRuntime(kiroRun());
    render(<Harness />);
    const user = userEvent.setup();
    const execute = await screen.findByRole("button", { name: "Execute run" });
    await user.click(execute);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((call) => call.endsWith("/execute"))).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(execute));
  });

  it("runs without shell on decline and does not ask again in the same session", async () => {
    const calls = stubRuntime(kiroRun());
    render(<Harness />);
    const user = userEvent.setup();
    const execute = await screen.findByRole("button", { name: "Execute run" });
    await user.click(execute);
    await user.click(await screen.findByRole("button", { name: "Run without shell" }));
    await waitFor(() => expect(calls.filter((call) => call.endsWith("/execute"))).toHaveLength(1));
    await user.click(execute);
    await waitFor(() => expect(calls.filter((call) => call.endsWith("/execute"))).toHaveLength(2));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls).not.toContain("POST /api/project/tool-grants");
  });

  it("skips the prompt for mock-only runs and for projects that already hold the grant", async () => {
    const calls = stubRuntime(kiroRun("mock"));
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Execute run" }));
    await waitFor(() => expect(calls.some((call) => call.endsWith("/execute"))).toBe(true));
    expect(calls).not.toContain("GET /api/project");
    cleanup();
    const granted = stubRuntime(kiroRun(), {
      ...projectConfig,
      toolGrants: { kiro: { scope: ["execute_bash"], grantedAt: "2026-10-07T10:00:00.000Z" } },
    });
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "Execute run" }));
    await waitFor(() => expect(granted.some((call) => call.endsWith("/execute"))).toBe(true));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the Codex consent text naming network access and outside writes", () => {
    const heading = { current: null };
    render(
      <ToolGrantDialog
        mode="run"
        prompt={{ provider: "codex", revision: null, pending: false, error: "" }}
        onAnswer={() => undefined}
        returnFocus={() => null}
        fallbackFocus={heading}
      />,
    );
    expect(screen.getByText(toolGrantText.codex.implication).textContent).toContain(
      "network access and writes outside the project",
    );
    expect(screen.getByText(toolGrantText.codex.implication).textContent).toContain(
      "branches, stash and config",
    );
    // In-sandbox commands still run by default, so the decline choice must not say "no shell".
    expect(screen.getByRole("button", { name: "Keep commands sandboxed" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run without shell" })).toBeNull();
  });
});

describe("Setup → Agent tool permission", () => {
  it("revokes a grant and announces that new steps use the default", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => respond({ project: projectConfig, revision: "r3" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onProjectChanged = vi.fn<(next: SavedProjectResponse) => void>();
    const state: ProjectResponse = {
      project: {
        ...projectConfig,
        toolGrants: { kiro: { scope: ["execute_bash"], grantedAt: "2026-10-07T10:00:00.000Z" } },
      },
      path: "/repo",
      revision: "r2",
    };
    // Like App, apply the saved project so the Revoke button is replaced by Allow….
    const Stateful = () => {
      const [current, setCurrent] = useState(state);
      return (
        <ToolPermissionsSection
          state={current}
          onProjectChanged={(next) => {
            onProjectChanged(next);
            setCurrent({ ...current, project: next.project, revision: next.revision });
          }}
        />
      );
    };
    render(<Stateful />);
    expect(screen.getByText(/Kiro: shell \(execute_bash\) allowed since/)).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Revoke Kiro shell permission" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/project/tool-grants/kiro",
      expect.objectContaining({ method: "DELETE", body: JSON.stringify({ revision: "r2" }) }),
    );
    expect(onProjectChanged).toHaveBeenCalledWith({ project: projectConfig, revision: "r3" });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Kiro shell permission revoked. New steps use the default tools.",
      ),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Allow Kiro shell permission…" }),
    );
  });
});
