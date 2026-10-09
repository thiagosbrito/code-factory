// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolPermissionsSection } from "../src/ui/features/setup/ToolPermissionsSection.js";
import { type ProjectPatch, type ProjectResponse } from "../src/ui/shared/project-api.js";
import { trustState } from "./fixtures/trust.js";
import { kiroGrant, projectConfig, respond } from "./support/run-branch-ui.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  location.hash = "";
});

describe("Setup → Agent tool permission", () => {
  const Stateful = ({
    state,
    onProjectChanged,
  }: {
    state: ProjectResponse;
    onProjectChanged: (next: ProjectPatch) => void;
  }) => {
    // Like App, apply each change so the buttons reflect the new state.
    const [current, setCurrent] = useState(state);
    return (
      <ToolPermissionsSection
        state={current}
        onProjectChanged={(next) => {
          onProjectChanged(next);
          setCurrent((previous) => ({ ...previous, ...next }));
        }}
      />
    );
  };

  it("revokes a grant and announces that new steps use the default", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => respond({ trust: trustState() }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onProjectChanged = vi.fn<(next: ProjectPatch) => void>();
    render(
      <Stateful
        state={{
          project: projectConfig,
          path: "/repo",
          revision: "r2",
          trust: trustState({ toolGrants: kiroGrant }),
        }}
        onProjectChanged={onProjectChanged}
      />,
    );
    expect(screen.getByText(/Kiro: shell \(execute_bash\) allowed since/)).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Revoke Kiro shell permission" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/project/tool-grants/kiro",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(onProjectChanged).toHaveBeenCalledWith({ trust: trustState() });
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Kiro shell permission revoked. New steps use the default tools.",
      ),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Allow Kiro shell permission…" }),
    );
  });

  it("keeps grants unavailable until the project is trusted, then trusts it from Setup", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => respond({ trust: trustState() }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <Stateful
        state={{
          project: projectConfig,
          path: "/repo",
          revision: "r2",
          trust: trustState({ trusted: false }),
        }}
        onProjectChanged={() => undefined}
      />,
    );
    expect(
      screen.getByText(/Code Factory runs nothing in this project until you trust it/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Allow Kiro shell permission…" }).hasAttribute("disabled"),
    ).toBe(true);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Trust project…" }));
    await user.click(await screen.findByRole("button", { name: "Trust project" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/project/trust",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ acknowledged: true }) }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Allow Kiro shell permission…" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(screen.getByRole("button", { name: "Stop trusting" })).toBeTruthy();
  });

  it("says that grants saved in the project's own files are ignored", () => {
    const notice = /Tool permissions saved in this project's files are ignored/;
    const { rerender } = render(
      <ToolPermissionsSection
        state={{ project: projectConfig, path: "/repo", revision: "r2", trust: trustState() }}
        onProjectChanged={() => undefined}
      />,
    );
    expect(screen.queryByText(notice)).toBeNull();
    rerender(
      <ToolPermissionsSection
        state={{
          project: { ...projectConfig, toolGrants: kiroGrant },
          path: "/repo",
          revision: "r2",
          trust: trustState(),
        }}
        onProjectChanged={() => undefined}
      />,
    );
    expect(screen.getByText(notice)).toBeTruthy();
    expect(screen.getByText(/Kiro: default tools only/)).toBeTruthy();
  });
});
