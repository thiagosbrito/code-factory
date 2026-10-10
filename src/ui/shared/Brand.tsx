import { ThemeToggle } from "./ThemeToggle";

export const Brand = () => {
  return (
    <div className="flex items-center gap-3 text-lg font-semibold tracking-tight">
      <span className="flex size-7 items-center justify-center rounded-lg bg-teal-500 text-white">
        ∞
      </span>
      code-factory
      <ThemeToggle />
    </div>
  );
};
