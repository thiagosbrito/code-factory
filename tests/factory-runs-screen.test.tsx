// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { SetStateAction } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { RunsScreen, type RunsScreenState } from "../src/ui/factory/RunsScreen.js";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const reload = vi.fn<() => void>();
const setSelectedRunId = vi.fn<(id: SetStateAction<string>) => void>();
const state = (overrides: Partial<RunsScreenState> = {}): RunsScreenState => ({
  selectedRun: undefined,
  selectedRunId: "",
  setSelectedRunId,
  historyState: "ready",
  historyError: "",
  connected: true,
  runs: [],
  reload,
  openRun: vi.fn<(id: string) => void>(),
  ...overrides,
});
const renderScreen = (overrides: Partial<RunsScreenState> = {}, runs = 0) =>
  render(
    <RunsScreen
      factory={state(overrides)}
      counts={{ loops: 0, runs }}
      renderSelected={() => <p>Selected run detail</p>}
      onCreate={() => {}}
      onTemplate={() => {}}
    />,
  );

it("shows a loading note while the history loads, before anything else", () => {
  renderScreen({ historyState: "loading", selectedRunId: "run-1", connected: false });
  expect(screen.getByText("Loading run history…")).toBeTruthy();
});

it("reports a history error with a retry that reloads", async () => {
  renderScreen({ historyState: "error", historyError: "Boom" });
  expect(screen.getByRole("alert").textContent).toContain("Boom");
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  expect(reload).toHaveBeenCalled();
});

it("waits for a selected run while connected and offers a way out when it is unavailable", async () => {
  const view = renderScreen({ selectedRunId: "run-1" });
  expect(screen.getByText("Loading selected run…")).toBeTruthy();
  view.unmount();
  renderScreen({ selectedRunId: "run-1", connected: false });
  expect(screen.getByRole("heading", { name: "Run unavailable" })).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "All runs" }));
  expect(setSelectedRunId).toHaveBeenCalledWith("");
  expect(window.location.hash).toBe("#runs");
});

it("explains a disconnected runtime when there is no history to show", () => {
  renderScreen({ connected: false });
  expect(screen.getByRole("heading", { name: "Runtime disconnected" })).toBeTruthy();
});

it("shows the empty state with working actions when there are no runs", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn<() => void>();
  const onTemplate = vi.fn<() => void>();
  render(
    <RunsScreen
      factory={state()}
      counts={{ loops: 0, runs: 0 }}
      renderSelected={() => null}
      onCreate={onCreate}
      onTemplate={onTemplate}
    />,
  );
  expect(screen.getByRole("heading", { name: "No runs yet" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Create loop" }));
  await user.click(screen.getByRole("button", { name: "Use starter template" }));
  expect(onCreate).toHaveBeenCalledOnce();
  expect(onTemplate).toHaveBeenCalledOnce();
});

it("notes saved runs when the count is not zero but no history is listed", () => {
  renderScreen({}, 3);
  expect(screen.getByText("3 saved runs")).toBeTruthy();
});
