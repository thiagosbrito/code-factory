import { useCallback, useState } from "react";

export const sidebarStorageKey = "code-factory.sidebar-collapsed";

const readStored = (): boolean => {
  try {
    return window.localStorage.getItem(sidebarStorageKey) === "true";
  } catch {
    return false;
  }
};

/** Whether the main sidebar is an icon rail; remembered per browser, never required to work. */
export const useSidebarCollapsed = () => {
  const [collapsed, setCollapsed] = useState(readStored);
  const toggle = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(sidebarStorageKey, String(next));
      } catch {
        // Storage can be blocked; the choice then lasts for this page load only.
      }
      return next;
    });
  }, []);
  return { collapsed, toggle };
};
