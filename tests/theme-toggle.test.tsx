// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "../src/ui/shared/ThemeToggle";
import { initTheme, themeStorageKey } from "../src/ui/shared/theme";

describe("theme toggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });
  afterEach(cleanup);

  it("starts light without matchMedia and switches to dark, persisting the choice", () => {
    initTheme();
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(themeStorageKey)).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem(themeStorageKey)).toBe("light");
  });

  it("restores the stored theme", () => {
    window.localStorage.setItem(themeStorageKey, "dark");
    initTheme();
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeTruthy();
  });
});
