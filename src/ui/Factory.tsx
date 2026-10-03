import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Brand } from "./Brand";
import type { FactoryResponse, ProjectResponse } from "./project-api";

export type Screen = "runs" | "loops" | "settings";
const screenLabels: Record<Screen, string> = {
  runs: "Runs",
  loops: "Loops",
  settings: "Settings",
};

function Sidebar({
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

function Empty({
  kind,
  onCreate,
  onTemplate,
}: {
  kind: "runs" | "loops";
  onCreate: () => void;
  onTemplate: () => void;
}) {
  return (
    <Card className="mt-7 flex min-h-80 flex-col items-center justify-center border-dashed bg-white/60 px-6 py-10 text-center">
      <div className="grid size-12 place-items-center rounded-xl bg-teal-50 text-2xl text-teal-700">
        {kind === "runs" ? "▷" : "∞"}
      </div>
      <h2 className="mt-4 text-xl font-semibold">
        {kind === "runs" ? "No runs yet" : "No user loops yet"}
      </h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
        {kind === "runs"
          ? "Create a loop for this project or start from an optional template. Demo runs never enter your history."
          : "Create an empty loop or choose an optional starter template."}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={onCreate}>Create loop</Button>
        <Button variant="outline" onClick={onTemplate}>
          Use starter template
        </Button>
      </div>
    </Card>
  );
}

export function Factory({
  project,
  counts,
  screen,
  setScreen,
  demo,
  onDemo,
  onExitDemo,
  onEditSetup,
}: {
  project: ProjectResponse;
  counts: FactoryResponse;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  demo: boolean;
  onDemo: () => void;
  onExitDemo: () => void;
  onEditSetup: () => void;
}) {
  const [notice, setNotice] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [screen]);
  const showCreate = () => {
    setScreen("loops");
    setNotice("Loop creation opens here when the loop editor is installed.");
  };
  const showTemplate = () => {
    setScreen("loops");
    setNotice("Starter templates become available with the loop library.");
  };
  return (
    <div className="min-h-screen bg-canvas md:flex">
      <Sidebar
        projectName={demo ? "Demo factory" : (project.project?.name ?? "Project")}
        screen={screen}
        setScreen={(next) => {
          setScreen(next);
          setNotice("");
        }}
        runs={demo ? 2 : counts.runs}
        demo={demo}
        onExitDemo={onExitDemo}
      />
      <main className="w-full flex-1 p-6 md:p-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-semibold tracking-tight">
              {screenLabels[screen]}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {screen === "runs"
                ? "Your local factory is configured. Runs appear after a loop is created."
                : screen === "loops"
                  ? "Reusable local workflows for future runs."
                  : "Project and connection settings"}
            </p>
          </div>
          {!demo && (
            <Button variant="outline" onClick={onDemo}>
              Open demo factory
            </Button>
          )}
        </div>
        {demo && (
          <p className="mt-6 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm">
            Demo factory · Sample content is separate from your project and is never saved.
          </p>
        )}
        {notice && (
          <output className="mt-5 block rounded-md border bg-white p-3 text-sm">{notice}</output>
        )}
        {screen === "settings" ? (
          <Card className="mt-7 p-6">
            <h2 className="font-semibold">Project</h2>
            <p className="mt-2 text-sm">{project.project?.name}</p>
            <p className="mt-1 break-all text-sm text-muted-foreground">{project.path}</p>
            <p className="mt-4 text-sm text-muted-foreground">
              Agent execution requires a verified connection. Project setup does not start a run.
            </p>
            {!demo && (
              <Button className="mt-5" variant="outline" onClick={onEditSetup}>
                Edit project setup
              </Button>
            )}
          </Card>
        ) : demo ? (
          <Card className="mt-7 p-8">
            <h2 className="text-lg font-semibold">Sample {screen}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Explore the layout without creating project history.
            </p>
          </Card>
        ) : counts[screen] === 0 ? (
          <Empty kind={screen} onCreate={showCreate} onTemplate={showTemplate} />
        ) : (
          <Card className="mt-7 p-6">
            <h2 className="font-semibold">
              {counts[screen]} saved {screen}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Saved items will be listed when the {screen} view is connected.
            </p>
          </Card>
        )}
      </main>
    </div>
  );
}
