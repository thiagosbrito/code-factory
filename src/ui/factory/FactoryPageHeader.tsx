import type { RefObject } from "react";
import { Button } from "@/shared/components/button";
import { screenLabels, type Screen } from "./FactorySidebar";

const subtitles: Record<Screen, string> = {
  runs: "Launch and review repeatable coding work.",
  loops: "Reusable local workflows for future runs.",
  settings: "Project and connection settings",
};

/** Screen title, the New run and demo actions, the demo banner and the transient notice. */
export const FactoryPageHeader = ({
  screen,
  demo,
  notice,
  headingRef,
  onNewRun,
  onDemo,
}: {
  screen: Screen;
  demo: boolean;
  notice: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onNewRun: () => void;
  onDemo: () => void;
}) => (
  <>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-semibold tracking-tight">
          {screenLabels[screen]}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{subtitles[screen]}</p>
      </div>
      {!demo && (
        <div className="flex gap-2">
          {screen === "runs" && <Button onClick={onNewRun}>New run</Button>}
          <Button variant="outline" onClick={onDemo}>
            Open demo factory
          </Button>
        </div>
      )}
    </div>
    {demo && (
      <p className="mt-6 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm">
        Demo factory · Sample content is separate from your project and is never saved.
      </p>
    )}
    {notice && (
      <output className="mt-5 block rounded-md border bg-card p-3 text-sm">{notice}</output>
    )}
  </>
);
