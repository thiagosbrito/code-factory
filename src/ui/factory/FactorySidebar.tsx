import { Button } from "@/shared/components/button";
import { Brand } from "../shared/Brand";
import {
  LoopsIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RunsIcon,
  SettingsIcon,
} from "../shared/icons";
import { ThemeToggle } from "../shared/ThemeToggle";

export type Screen = "runs" | "loops" | "settings";
export const screenLabels: Record<Screen, string> = {
  runs: "Runs",
  loops: "Loops",
  settings: "Settings",
};

const screenIcons: Record<Screen, () => React.ReactElement> = {
  runs: RunsIcon,
  loops: LoopsIcon,
  settings: SettingsIcon,
};

export const FactorySidebar = ({
  projectName,
  screen,
  setScreen,
  runs,
  demo,
  onExitDemo,
  collapsed,
  onToggleCollapsed,
}: {
  projectName: string;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  runs: number;
  demo: boolean;
  onExitDemo: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) => {
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <aside
      className={`flex min-h-screen w-full flex-col bg-graphite p-5 text-white ${
        collapsed ? "md:w-16 md:px-2" : "md:w-60"
      }`}
    >
      <Brand collapsed={collapsed} />
      {!collapsed && (
        <>
          <div className="mt-10 text-[11px] font-semibold tracking-widest text-stone-400">
            PROJECT
          </div>
          <div className="mt-2 rounded-lg bg-white/10 p-3">
            <strong className="block truncate text-sm">{projectName}</strong>
            <small className="text-stone-300">{demo ? "Demo workspace" : "Local workspace"}</small>
          </div>
        </>
      )}
      <nav aria-label="Factory" className={`grid gap-1 ${collapsed ? "mt-6" : "mt-8"}`}>
        {(["runs", "loops", "settings"] as const).map((item) => {
          const ItemIcon = screenIcons[item];
          return (
            <button
              key={item}
              onClick={() => setScreen(item)}
              aria-current={screen === item ? "page" : undefined}
              // The collapsed rail shows the icon only, so the label moves to the name and tooltip.
              {...(collapsed
                ? {
                    "aria-label":
                      item === "runs" ? `${screenLabels[item]} (${runs})` : screenLabels[item],
                    title: screenLabels[item],
                  }
                : {})}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                collapsed ? "justify-center" : ""
              } ${screen === item ? "bg-white/15" : "hover:bg-white/10"}`}
            >
              <ItemIcon />
              {!collapsed && (
                <>
                  {screenLabels[item]}
                  {item === "runs" && (
                    <span aria-hidden="true" className="ml-auto text-stone-300">
                      {runs}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto grid gap-3 pt-8 text-xs text-stone-300">
        {collapsed ? (
          <div className="flex justify-center">
            <ThemeToggle placement="inline" />
          </div>
        ) : demo ? (
          <Button variant="secondary" size="sm" onClick={onExitDemo}>
            Exit demo
          </Button>
        ) : (
          "Agent execution requires verified availability"
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          title={toggleLabel}
          className={`hidden size-8 items-center justify-center rounded-lg hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:flex ${collapsed ? "md:justify-self-center" : "md:justify-self-end"}`}
        >
          {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
        </button>
      </div>
    </aside>
  );
};
