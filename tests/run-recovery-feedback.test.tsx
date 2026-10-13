// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RunDetail } from "../src/ui/features/runs/RunDetail.js";
import { claim, run } from "./support/scheduler.js";

afterEach(cleanup);
it("explains an orphaned run and offers cancellation without provider recovery", () => {
  render(
    <RunDetail
      run={claim(run(), "build")}
      summary={null}
      accepting={false}
      connected
      streamConnected
      executing={false}
      interrupted
      onAccept={() => undefined}
      onExecute={() => undefined}
      onCancel={() => undefined}
      onBack={() => undefined}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("Execution is no longer active");
  expect(screen.getByRole("alert").textContent).toContain("Cancel run");
  expect(screen.getByRole("button", { name: "Cancel run" })).toBeTruthy();
});
it("shows a runtime persistence error even when the locked run file cannot change", () => {
  render(
    <RunDetail
      run={claim(run(), "build")}
      summary={null}
      accepting={false}
      connected
      executing={false}
      interrupted
      executionError="EPERM: run file is locked"
      onAccept={() => undefined}
      onExecute={() => undefined}
      onCancel={() => undefined}
      onBack={() => undefined}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("EPERM: run file is locked");
  expect(screen.getByRole("alert").textContent).toContain("saved status");
});
