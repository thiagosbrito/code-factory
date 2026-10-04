import type { RefObject } from "react";
import { Input } from "@/components/ui/input";
import { SetupSection } from "./SetupSection";

export const ProjectSetupSection = ({
  statePath,
  name,
  nameRef,
  error,
  onNameChange,
}: {
  statePath: string;
  name: string;
  nameRef: RefObject<HTMLInputElement | null>;
  error: string;
  onNameChange: (value: string) => void;
}) => {
  return (
    <SetupSection
      number={1}
      title="Project"
      description="Local workspace selected when Code Factory started"
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
        <label className="grid gap-2 text-sm font-medium" htmlFor="project-name">
          Project name
          <Input
            ref={nameRef}
            id="project-name"
            value={name}
            onChange={(event) => {
              onNameChange(event.target.value);
            }}
            aria-invalid={Boolean(error && !name.trim())}
            aria-describedby={error ? "setup-error" : undefined}
            placeholder="my-application"
          />
        </label>
        <div className="grid gap-2 text-sm font-medium">
          <span>Local project path</span>
          <div
            className="flex min-h-10 items-center overflow-x-auto rounded-md border border-input bg-canvas px-3 text-sm font-normal"
            aria-label="Canonical project path"
          >
            {statePath}
          </div>
          <small className="font-normal text-muted-foreground">
            Validated by the local runtime. Restart with --project to use another workspace.
          </small>
        </div>
      </div>
    </SetupSection>
  );
};
