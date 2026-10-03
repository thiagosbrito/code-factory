import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { FactoryResponse, ProjectResponse } from "./project-api";
import { FactoryEmptyState } from "./FactoryEmptyState";
import { FactorySidebar, screenLabels, type Screen } from "./FactorySidebar";

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
      <FactorySidebar
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
          <FactoryEmptyState kind={screen} onCreate={showCreate} onTemplate={showTemplate} />
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
