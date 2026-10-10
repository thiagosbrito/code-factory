import { ThemeToggle } from "./ThemeToggle";

/** The product mark; collapsed, only the mark remains (the sidebar then carries the theme toggle). */
export const Brand = ({ collapsed = false }: { collapsed?: boolean }) => {
  return (
    <div
      className={`flex items-center text-lg font-semibold tracking-tight ${collapsed ? "justify-center" : "gap-3"}`}
    >
      <span
        title="code-factory"
        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-teal-500 text-white"
      >
        ∞
      </span>
      {!collapsed && (
        <>
          code-factory
          <ThemeToggle />
        </>
      )}
    </div>
  );
};
