import { MoonIcon, SunIcon } from "./icons";
import { useTheme } from "./theme";

/** `placement` "end" pushes the button to the row's right edge; "inline" leaves it where it is put. */
export const ThemeToggle = ({ placement = "end" }: { placement?: "end" | "inline" }) => {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={`${placement === "end" ? "ml-auto " : ""}flex size-8 items-center justify-center rounded-lg hover:bg-current/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
};
