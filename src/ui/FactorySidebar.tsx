import { Button } from "@/components/ui/button";
import { Brand } from "./Brand";

export type Screen = "runs" | "loops" | "settings";
export const screenLabels: Record<Screen, string> = {
  runs: "Runs",
  loops: "Loops",
  settings: "Settings",
};

export function FactorySidebar({
  projectName,
  screen,
  setScreen,
  runs,
  demo,
  onExitDemo,
}: {
  projectName: string;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  runs: number;
  demo: boolean;
  onExitDemo: () => void;
}) {
  return (
    <aside className="flex min-h-screen w-full flex-col bg-graphite p-5 text-white md:w-60">
      <Brand />
      <div className="mt-10 text-[11px] font-semibold tracking-widest text-stone-400">PROJECT</div>
      <div className="mt-2 rounded-lg bg-white/10 p-3">
        <strong className="block truncate text-sm">{projectName}</strong>
        <small className="text-stone-300">{demo ? "Demo workspace" : "Local workspace"}</small>
      </div>
      <nav aria-label="Factory" className="mt-8 grid gap-1">
        {(["runs", "loops", "settings"] as const).map((item) => (
          <button
            key={item}
            onClick={() => setScreen(item)}
            aria-current={screen === item ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-left text-sm capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${screen === item ? "bg-white/15" : "hover:bg-white/10"}`}
          >
            {screenLabels[item]}
            {item === "runs" && (
              <span aria-hidden="true" className="float-right text-stone-300">
                {runs}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="mt-auto pt-8 text-xs text-stone-300">
        {demo ? (
          <Button variant="secondary" size="sm" onClick={onExitDemo}>
            Exit demo
          </Button>
        ) : (
          "Agent execution requires verified availability"
        )}
      </div>
    </aside>
  );
}
