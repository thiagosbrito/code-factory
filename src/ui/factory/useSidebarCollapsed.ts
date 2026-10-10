import { useCallback, useState, useSyncExternalStore } from "react";

export const sidebarStorageKey = "code-factory.sidebar-collapsed";

/** The width (Tailwind's md) at which the sidebar sits beside the page and can become a rail. */
const wideQuery = "(min-width: 768px)";

const readStored = (): boolean => {
  try {
    return window.localStorage.getItem(sidebarStorageKey) === "true";
  } catch {
    return false;
  }
};

const subscribeWide = (notify: () => void) => {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(wideQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

const isWide = (): boolean =>
  typeof window.matchMedia !== "function" || window.matchMedia(wideQuery).matches;

/**
 * Whether the main sidebar is an icon rail. The choice is remembered per browser, never required
 * to work, and only applies on wide screens: below md the sidebar is stacked above the page, its
 * toggle is hidden, so a rail saved on a desktop must not strand a narrow window without labels.
 */
export const useSidebarCollapsed = () => {
  const [stored, setStored] = useState(readStored);
  const wide = useSyncExternalStore(subscribeWide, isWide, () => true);
  const toggle = useCallback(() => {
    const next = !stored;
    setStored(next);
    try {
      window.localStorage.setItem(sidebarStorageKey, String(next));
    } catch {
      // Storage can be blocked; the choice then lasts for this page load only.
    }
  }, [stored]);
  return { collapsed: stored && wide, toggle };
};
