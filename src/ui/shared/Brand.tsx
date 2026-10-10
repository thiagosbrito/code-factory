import { LogoMark } from "./LogoMark";
import { ThemeToggle } from "./ThemeToggle";

export const Brand = () => {
  return (
    <div className="flex items-center gap-3 text-lg font-semibold tracking-tight">
      <span className="flex shrink-0 text-teal-400">
        <LogoMark />
      </span>
      code-factory
      <ThemeToggle />
    </div>
  );
};
