import { ThemeToggle } from "./ThemeToggle";

/** The product mark; collapsed, only the mark remains (the sidebar then carries the theme toggle). */
export const Brand = ({
  collapsed = false,
  title = "code-factory",
}: {
  collapsed?: boolean;
  /** Tooltip of the mark; the collapsed rail uses it to name the project. */
  title?: string;
}) => {
  return (
    <div
      className={`flex items-center text-lg font-semibold tracking-tight ${collapsed ? "justify-center" : "gap-3"}`}
    >
      <span
        title={title}
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
