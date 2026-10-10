import { MoonIcon, SunIcon } from "./icons";
import { useTheme } from "./theme";

export const ThemeToggle = () => {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="ml-auto flex size-8 items-center justify-center rounded-lg hover:bg-current/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
};
