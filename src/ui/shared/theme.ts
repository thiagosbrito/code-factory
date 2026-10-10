import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

export const themeStorageKey = "code-factory:theme";

const readStored = (): Theme | undefined => {
  try {
    const value = window.localStorage.getItem(themeStorageKey);
    return value === "light" || value === "dark" ? value : undefined;
  } catch {
    return undefined;
  }
};

const systemTheme = (): Theme =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";

export const resolveTheme = (): Theme => readStored() ?? systemTheme();

const listeners = new Set<() => void>();

const currentTheme = (): Theme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

const apply = (theme: Theme) => {
  document.documentElement.classList.toggle("dark", theme === "dark");
  listeners.forEach((listener) => listener());
};

/** Applies the stored or system theme to the document; call once before first render. */
export const initTheme = () => apply(resolveTheme());

export const setTheme = (theme: Theme) => {
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // Storage can be blocked; the choice then lasts for this page load only.
  }
  apply(theme);
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useTheme = () => {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as const);
  const toggle = useCallback(() => setTheme(currentTheme() === "dark" ? "light" : "dark"), []);
  return { theme, toggle };
};
