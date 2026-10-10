// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FactorySidebar, type Screen } from "../src/ui/factory/FactorySidebar.js";
import { sidebarStorageKey, useSidebarCollapsed } from "../src/ui/factory/useSidebarCollapsed.js";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const Harness = ({
  onScreen,
  demo = false,
  onExitDemo,
}: {
  onScreen?: (screen: Screen) => void;
  demo?: boolean;
  onExitDemo?: () => void;
}) => {
  const sidebar = useSidebarCollapsed();
  const [screen, setScreen] = useState<Screen>("runs");
  return (
    <FactorySidebar
      projectName="Triple A"
      screen={screen}
      setScreen={(next) => {
        setScreen(next);
        onScreen?.(next);
      }}
      runs={3}
      demo={demo}
      onExitDemo={onExitDemo ?? (() => undefined)}
      collapsed={sidebar.collapsed}
      onToggleCollapsed={sidebar.toggle}
    />
  );
};

describe("collapsible main sidebar", () => {
  it("starts expanded with the project card and labelled navigation", () => {
    render(<Harness />);
    expect(screen.getByText("Triple A")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Runs" })).toBeTruthy();
  });

  it("collapses to a rail that keeps every destination reachable and remembers the choice", async () => {
    const onScreen = vi.fn<(screen: Screen) => void>();
    const { unmount } = render(<Harness onScreen={onScreen} />);
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(screen.queryByText("Triple A")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: "Runs" }).getAttribute("aria-current")).toBe("page");
    // The rail still switches theme.
    expect(screen.getByRole("button", { name: /Switch to (dark|light) mode/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Loops" }));
    expect(onScreen).toHaveBeenCalledWith("loops");

    unmount();
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByText("Triple A")).toBeTruthy();
    expect(window.localStorage.getItem(sidebarStorageKey)).toBe("false");
  });

  it("still works when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });

  it("keeps the toggle focused after collapsing", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }).getAttribute("aria-controls"),
    ).toBe("factory-sidebar");
  });

  it("starts collapsed from a stored choice and treats any other stored value as expanded", () => {
    window.localStorage.setItem(sidebarStorageKey, "true");
    const { unmount } = render(<Harness />);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
    unmount();
    window.localStorage.setItem(sidebarStorageKey, "maybe");
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeTruthy();
  });

  it("keeps the project identity, run count and capability notice reachable in the rail", async () => {
    window.localStorage.setItem(sidebarStorageKey, "true");
    render(<Harness />);
    expect(screen.getByText("Agent execution requires verified availability")).toBeTruthy();
    expect(screen.getByTitle(/Triple A/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Runs" }).getAttribute("title")).toBe("Runs (3)");
  });

  it("keeps Exit demo reachable in the rail", async () => {
    window.localStorage.setItem(sidebarStorageKey, "true");
    const onExitDemo = vi.fn<() => void>();
    render(<Harness demo onExitDemo={onExitDemo} />);
    await userEvent.click(screen.getByRole("button", { name: "Exit demo" }));
    expect(onExitDemo).toHaveBeenCalledOnce();
  });

  it("ignores a stored rail below the md breakpoint, where the toggle is hidden", () => {
    window.localStorage.setItem(sidebarStorageKey, "true");
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    render(<Harness demo />);
    // Full sidebar: project card and the labelled Exit demo button.
    expect(screen.getByText("Triple A")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Exit demo" }).textContent).toBe("Exit demo");
    vi.unstubAllGlobals();
  });
});
