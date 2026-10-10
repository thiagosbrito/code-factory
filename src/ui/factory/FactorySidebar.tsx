import { Button } from "@/shared/components/button";
import { Brand } from "../shared/Brand";
import {
  BookIcon,
  LoopsIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  ExitDemoIcon,
  InfoIcon,
  RunsIcon,
  SettingsIcon,
} from "../shared/icons";
import { ThemeToggle } from "../shared/ThemeToggle";

export type Screen = "runs" | "loops" | "settings" | "manual";
export const screenLabels: Record<Screen, string> = {
  runs: "Runs",
  loops: "Loops",
  settings: "Settings",
  manual: "User manual",
};

const availabilityNotice = "Agent execution requires verified availability";

const screenIcons: Record<Exclude<Screen, "manual">, () => React.ReactElement> = {
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
      id="factory-sidebar"
      className={`flex min-h-screen w-full flex-col bg-graphite p-5 text-white ${
        collapsed ? "md:w-16 md:px-2" : "md:w-60"
      }`}
    >
      <Brand
        collapsed={collapsed}
        title={`code-factory · ${projectName} · ${demo ? "Demo workspace" : "Local workspace"}`}
      />
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
      <span id="factory-runs-count" className="sr-only">
        {runs} {runs === 1 ? "run" : "runs"}
      </span>
      <nav aria-label="Factory" className={`grid gap-1 ${collapsed ? "mt-6" : "mt-8"}`}>
        {(["runs", "loops", "settings"] as const).map((item) => {
          const ItemIcon = screenIcons[item];
          return (
            <button
              key={item}
              onClick={() => setScreen(item)}
              aria-current={screen === item ? "page" : undefined}
              // The count is a description, so the name stays "Runs" whether or not the rail is collapsed.
              {...(item === "runs" ? { "aria-describedby": "factory-runs-count" } : {})}
              // The collapsed rail shows the icon only, so the label moves to the name and tooltip.
              {...(collapsed
                ? {
                    "aria-label": screenLabels[item],
                    title: item === "runs" ? `${screenLabels[item]} (${runs})` : screenLabels[item],
                  }
                : {})}
              className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                collapsed ? "justify-center" : ""
              } ${screen === item ? "bg-white/15" : "hover:bg-white/10"}`}
            >
              <ItemIcon />
              {collapsed && item === "runs" && runs > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-teal-500 px-1 text-center text-[10px] font-semibold leading-4 text-white"
                >
                  {runs}
                </span>
              )}
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
          <>
            <div className="flex justify-center">
              <ThemeToggle placement="inline" />
            </div>
            {demo && (
              <button
                type="button"
                onClick={onExitDemo}
                aria-label="Exit demo"
                title="Exit demo"
                className="flex size-8 items-center justify-center justify-self-center rounded-lg hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ExitDemoIcon />
              </button>
            )}
            {!demo && (
              <span
                title={availabilityNotice}
                className="flex size-8 items-center justify-center justify-self-center"
              >
                <InfoIcon />
                <span className="sr-only">{availabilityNotice}</span>
              </span>
            )}
          </>
        ) : demo ? (
          <Button variant="secondary" size="sm" onClick={onExitDemo}>
            Exit demo
          </Button>
        ) : (
          availabilityNotice
        )}
        <button
          type="button"
          onClick={() => setScreen("manual")}
          aria-current={screen === "manual" ? "page" : undefined}
          {...(collapsed ? { "aria-label": screenLabels.manual, title: screenLabels.manual } : {})}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
            collapsed ? "justify-center" : ""
          } ${screen === "manual" ? "bg-white/15 text-white" : "hover:bg-white/10"}`}
        >
          <BookIcon />
          {!collapsed && screenLabels.manual}
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          aria-controls="factory-sidebar"
          title={toggleLabel}
          className={`hidden size-8 items-center justify-center rounded-lg hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:flex ${collapsed ? "md:justify-self-center" : "md:justify-self-end"}`}
        >
          {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
        </button>
      </div>
    </aside>
  );
};
