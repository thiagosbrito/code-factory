// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type EvidenceSummary } from "../src/domain/acceptance.js";
import { REMOVAL_DIRTY, type RunWorkspace } from "../src/domain/run-branch.js";
import { RunWorkspacePanel } from "../src/ui/features/runs/RunWorkspacePanel.js";

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

  it("keeps the remove dialog open and shows why when removal is refused", async () => {
    render(
      <RunWorkspacePanel
        workspace={workspace()}
        summary={summary("accepted")}
        connected
        busy={false}
        onPromote={async () => ({})}
        onReturn={async () => null}
        onRemove={async () => "The worktree has uncommitted changes."}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove worktree…" }));
    await user.click(screen.getByRole("button", { name: "Remove worktree" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toBe(
        "The worktree has uncommitted changes.",
      ),
    );
    expect(screen.getByRole("button", { name: "Remove worktree" })).toBeTruthy();
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
