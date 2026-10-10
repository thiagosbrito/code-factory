// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initTheme, resolveTheme, setTheme, themeStorageKey } from "../src/ui/shared/theme";

const themeInitScript = readFileSync("public/theme-init.js", "utf8");

const stubSystem = (dark: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query === "(prefers-color-scheme: dark)",
  }));

const runThemeInit = () => {
  document.documentElement.classList.remove("dark");
  new Function(themeInitScript)();
  return document.documentElement.classList.contains("dark");
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("theme resolution", () => {
  it("prefers a stored choice over the system theme", () => {
    stubSystem(true);
    window.localStorage.setItem(themeStorageKey, "light");
    expect(resolveTheme()).toBe("light");
    window.localStorage.setItem(themeStorageKey, "dark");
    stubSystem(false);
    expect(resolveTheme()).toBe("dark");
  });

  it("follows the system theme when nothing valid is stored", () => {
    stubSystem(true);
    expect(resolveTheme()).toBe("dark");
    window.localStorage.setItem(themeStorageKey, "purple");
    expect(resolveTheme()).toBe("dark");
    stubSystem(false);
    expect(resolveTheme()).toBe("light");
  });

  it("falls back to light when storage throws or matchMedia is missing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.stubGlobal("matchMedia", undefined);
    expect(resolveTheme()).toBe("light");
  });

  it("still applies the theme when storage rejects the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setTheme("dark")).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("initTheme applies the resolved theme to the document", () => {
    stubSystem(true);
    initTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    setTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("pre-paint theme script", () => {
  it("agrees with the application for every stored and system combination", () => {
    for (const stored of [undefined, "light", "dark", "garbage"]) {
      for (const systemDark of [false, true]) {
        window.localStorage.clear();
        if (stored) window.localStorage.setItem(themeStorageKey, stored);
        stubSystem(systemDark);
        expect(runThemeInit(), `stored=${stored} systemDark=${systemDark}`).toBe(
          resolveTheme() === "dark",
        );
      }
    }
  });

  it("stays light without throwing when storage is blocked or matchMedia is missing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(runThemeInit()).toBe(false);
    vi.restoreAllMocks();
    vi.stubGlobal("matchMedia", undefined);
    expect(runThemeInit()).toBe(false);
  });
});

describe("index.html and the Content-Security-Policy", () => {
  it("loads scripts only from files, never inline, because the runtime sends script-src 'self'", () => {
    const html = readFileSync("index.html", "utf8");
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attributes, body] of scripts) {
      expect(attributes).toMatch(/\bsrc="/);
      expect(body?.trim()).toBe("");
    }
    expect(html).toContain('src="/theme-init.js"');
  });
});

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(directory, entry.name))
      : /\.tsx?$/.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );

describe("light-only colors cannot return", () => {
  // The sidebar is graphite in both themes, so its white overlays and text are intentional.
  const files = sourceFiles("src/ui").filter((file) => !file.endsWith("FactorySidebar.tsx"));

  it("uses the card token instead of bg-white, including translucent variants", () => {
    const offenders = files.filter((file) => /\bbg-white\b/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("keeps hex colors in styles.css variables, not in components", () => {
    const offenders = files.filter((file) => /#[0-9a-fA-F]{6}\b/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
