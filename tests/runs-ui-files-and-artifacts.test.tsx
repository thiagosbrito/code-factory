// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { parseLoop } from "../src/domain/loop.js";
import {
  createRunRecord,
  createRunSnapshot,
  startAttempt,
  finishAttempt,
  runRecordSchema,
} from "../src/domain/run.js";
import { RunDetail } from "../src/ui/features/runs/RunDetail.js";
import { RunInspector } from "../src/ui/features/runs/RunInspector.js";
import { RunInspectorFiles } from "../src/ui/features/runs/RunInspectorFiles.js";
import { RunInspectorArtifacts } from "../src/ui/features/runs/RunInspectorArtifacts.js";
import { downloadBytes } from "../src/ui/features/runs/inspection-api.js";
import { type RunScope } from "../src/ui/features/runs/run-view-model.js";
import { makeRun } from "./support/runs-ui.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "#");
});

it("keeps files and artifacts on their exact step attempt with recorded provenance", async () => {
  const run = makeRun();
  const buildAttempt = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  const reviewAttempt = run.steps.find((step) => step.stepId === "review")?.attempts[0]?.id;
  if (!buildAttempt || !reviewAttempt) throw new Error("Missing attempts");
  const provenance = {
    source: "agent" as const,
    baselineId: run.snapshot.baseline.id,
    candidateId: "candidate-1",
    inputReceiptIds: [],
  };
  const freshness = { state: "current" as const, checkedAgainstCandidateId: "candidate-1" };
  const withEvidence = {
    ...run,
    evidence: [
      ...run.evidence,
      {
        kind: "file" as const,
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "build",
        attemptId: buildAttempt,
        createdAt: new Date().toISOString(),
        path: "src/build.ts",
        change: "modified" as const,
        additions: 4,
        deletions: 1,
        diffDigest: "digest-1",
        provenance,
        freshness,
      },
      {
        kind: "artifact" as const,
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "review",
        attemptId: reviewAttempt,
        createdAt: new Date().toISOString(),
        name: "review.md",
        mediaType: "text/markdown",
        relativePath: "reports/review.md",
        digest: "digest-2",
        provenance,
        freshness,
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path.includes("/diff?")
              ? {
                  path: "src/build.ts",
                  diff: "diff --git a/src/build.ts b/src/build.ts\n",
                  change: { path: "src/build.ts", change: "modified", attribution: "recorded" },
                }
              : {
                  baselineRevision: "baseline",
                  files: [
                    {
                      path: "src/build.ts",
                      change: "modified",
                      attribution: "recorded",
                      stepId: "build",
                      attemptId: buildAttempt,
                    },
                  ],
                  preExisting: [],
                },
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  render(
    <RunDetail
      run={withEvidence}
      connected
      executing={false}
      onExecute={vi.fn<() => void>()}
      onCancel={vi.fn<() => void>()}
      onBack={vi.fn<() => void>()}
      summary={null}
      accepting={false}
      onAccept={vi.fn<() => void>()}
    />,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: /Build, running/ }));
  await userEvent.setup().click(screen.getByRole("tab", { name: /^Files/ }));
  expect(await screen.findAllByText("src/build.ts")).toHaveLength(2);
  await userEvent.setup().click(screen.getByRole("tab", { name: /^Artifacts/ }));
  expect(screen.queryByText("review.md")).toBeNull();
  await userEvent.setup().click(screen.getByRole("tab", { name: "Details" }));
  expect(screen.getByText(/Candidate candidate-1/)).toBeTruthy();
  expect(screen.getByText("plan")).toBeTruthy();
});

it("filters baseline changes by path and type, with keyboard operable file selection", async () => {
  const run = makeRun();
  const attemptId = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  if (!attemptId) throw new Error("Missing attempt");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path.includes("/diff?")
              ? {
                  path: "src/task.ts",
                  diff: "+task",
                  change: { path: "src/task.ts", change: "modified", attribution: "recorded" },
                }
              : {
                  baselineRevision: "baseline",
                  files: [
                    {
                      path: "src/task.ts",
                      change: "modified",
                      attribution: "recorded",
                      stepId: "build",
                      attemptId,
                    },
                    { path: "notes.txt", change: "added", attribution: "uncertain" },
                  ],
                  preExisting: [
                    { path: "prior.txt", change: "modified", attribution: "uncertain" },
                  ],
                },
          ),
          { status: 200 },
        ),
    ),
  );
  const view = render(<RunInspectorFiles run={run} scope={{ kind: "run" }} />);
  expect(await screen.findByText("prior.txt")).toBeTruthy();
  expect(screen.getByText("notes.txt")).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("Change type"), "modified");
  expect(screen.queryByText("notes.txt")).toBeNull();
  await userEvent.type(screen.getByLabelText("Search paths"), "missing");
  expect(screen.getByText("No paths match these filters.")).toBeTruthy();
  await userEvent.clear(screen.getByLabelText("Search paths"));
  const file = screen.getByRole("button", { name: /src\/task.ts/ });
  file.focus();
  await userEvent.keyboard("{Enter}");
  expect(file.getAttribute("aria-current")).toBe("true");
  view.rerender(
    <RunInspectorFiles run={run} scope={{ kind: "step", stepId: "review", attemptId: null }} />,
  );
  expect(screen.getByText(/No task changes are available for this scope/)).toBeTruthy();
});

it("shows artifact provenance and safe unsupported preview while retaining download bytes and name", async () => {
  const run = makeRun();
  const attemptId = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  if (!attemptId) throw new Error("Missing attempt");
  const receipt = {
    kind: "artifact" as const,
    id: crypto.randomUUID(),
    runId: run.snapshot.id,
    stepId: "build",
    attemptId,
    createdAt: new Date().toISOString(),
    name: "report.bin",
    mediaType: "application/octet-stream",
    relativePath: "reports/report.bin",
    digest: "digest",
    provenance: {
      source: "agent" as const,
      baselineId: run.snapshot.baseline.id,
      candidateId: "candidate",
      inputReceiptIds: [],
    },
    freshness: { state: "superseded" as const, checkedAgainstCandidateId: "candidate" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ name: receipt.name, mediaType: receipt.mediaType, base64: "AAEC" }),
          { status: 200 },
        ),
    ),
  );
  const blob = vi.fn<(value: Blob) => string>(() => "blob:artifact");
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: blob,
    revokeObjectURL: vi.fn<(url: string) => void>(),
  });
  let downloaded = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloaded = this.download;
  });
  render(
    <RunInspectorArtifacts
      run={{ ...run, evidence: [...run.evidence, receipt] }}
      scope={{ kind: "step", stepId: "build", attemptId }}
    />,
  );
  expect(await screen.findByText(/Preview unavailable for this file type/)).toBeTruthy();
  expect(screen.getAllByText(/superseded/).length).toBeGreaterThan(0);
  expect(screen.getByText(`${run.snapshot.baseline.id} / candidate`)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Download" }));
  expect(downloaded).toBe("report.bin");
  expect(blob.mock.calls[0]?.[0].type).toBe("application/octet-stream");
  downloadBytes("nested/other.json", new Uint8Array([123, 125]), "application/json");
  expect(downloaded).toBe("other.json");
});

it("previews Markdown and JSON as safe content and selects receipts by keyboard", async () => {
  const run = makeRun();
  const attemptId = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  if (!attemptId) throw new Error("Missing attempt");
  const common = {
    kind: "artifact" as const,
    runId: run.snapshot.id,
    stepId: "build",
    attemptId,
    createdAt: new Date().toISOString(),
    digest: "digest",
    provenance: {
      source: "agent" as const,
      baselineId: run.snapshot.baseline.id,
      candidateId: "candidate",
      inputReceiptIds: [],
    },
    freshness: { state: "current" as const },
  };
  const markdown = {
    ...common,
    id: crypto.randomUUID(),
    name: "notes.md",
    relativePath: "notes.md",
    mediaType: "text/markdown",
  };
  const json = {
    ...common,
    id: crypto.randomUUID(),
    name: "data.json",
    relativePath: "data.json",
    mediaType: "application/json",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      const isJson = path.includes(json.id);
      const content = isJson ? '{"ok":true}' : "# Title\n<script>alert(1)</script>";
      return new Response(
        JSON.stringify({
          name: isJson ? json.name : markdown.name,
          mediaType: isJson ? json.mediaType : markdown.mediaType,
          base64: btoa(content),
        }),
        { status: 200 },
      );
    }),
  );
  render(
    <RunInspectorArtifacts
      run={{ ...run, evidence: [...run.evidence, markdown, json] }}
      scope={{ kind: "run" }}
    />,
  );
  expect(await screen.findByRole("heading", { name: "Title" })).toBeTruthy();
  expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
  const item = screen.getByRole("button", { name: /data.json/ });
  item.focus();
  await userEvent.keyboard("{Enter}");
  expect(item.getAttribute("aria-current")).toBe("true");
  expect(await screen.findByText(/"ok": true/)).toBeTruthy();
});

it("shows invalidated receipt freshness in Details while an independent sibling stays current", () => {
  const run = makeRun();
  const buildAttempt = run.steps.find((step) => step.stepId === "build")?.attempts[0]?.id;
  const reviewAttempt = run.steps.find((step) => step.stepId === "review")?.attempts[0]?.id;
  if (!buildAttempt || !reviewAttempt) throw new Error("Missing attempts");
  const receipt = (stepId: string, attemptId: string) => ({
    kind: "artifact" as const,
    id: crypto.randomUUID(),
    runId: run.snapshot.id,
    stepId,
    attemptId,
    createdAt: new Date().toISOString(),
    name: `${stepId}.md`,
    mediaType: "text/markdown",
    relativePath: `reports/${stepId}.md`,
    digest: `${stepId}-digest`,
    provenance: {
      source: "agent" as const,
      baselineId: run.snapshot.baseline.id,
      candidateId: "candidate-1",
      inputReceiptIds: [],
    },
    freshness: { state: "current" as const, checkedAgainstCandidateId: "candidate-1" },
  });
  const withInvalidation = {
    ...run,
    evidence: [
      ...run.evidence,
      receipt("build", buildAttempt),
      receipt("review", reviewAttempt),
      {
        kind: "event" as const,
        id: crypto.randomUUID(),
        runId: run.snapshot.id,
        stepId: "build",
        createdAt: new Date().toISOString(),
        type: "lifecycle" as const,
        title: "retry-invalidated",
        sequence: 2,
      },
    ],
  };
  const props = {
    run: withInvalidation,
    onScopeChange: vi.fn<(scope: RunScope) => void>(),
    onClose: vi.fn<() => void>(),
    connected: true,
    initialTab: "Details" as const,
  };
  const view = render(
    <RunInspector {...props} scope={{ kind: "step", stepId: "build", attemptId: buildAttempt }} />,
  );
  const provenanceSection = screen.getByText("Evidence provenance").parentElement;
  if (!provenanceSection) throw new Error("Missing provenance section");
  expect(within(provenanceSection).getByRole("listitem").textContent).toContain(
    "artifact · agent · superseded · needs revalidation",
  );
  view.rerender(
    <RunInspector
      {...props}
      scope={{ kind: "step", stepId: "review", attemptId: reviewAttempt }}
    />,
  );
  const siblingProvenance = screen.getByText("Evidence provenance").parentElement;
  if (!siblingProvenance) throw new Error("Missing sibling provenance section");
  expect(within(siblingProvenance).getByRole("listitem").textContent).toContain(
    "artifact · agent · current",
  );
});

it("confirms a failed step retry and restores focus after Escape and confirmation", async () => {
  const loop = parseLoop({
    schemaVersion: 2,
    id: "retry",
    name: "Retry",
    version: 1,
    status: "published",
    steps: [{ id: "build", name: "Build", kind: "agent", role: "builder", instruction: "Build" }],
    dependencies: [],
    groups: [],
    joins: [],
    decisions: [],
    policy: { maxAttemptsPerStep: 2, maxImplementationRounds: 2 },
  });
  const pending = createRunRecord(
    createRunSnapshot(loop, { description: "Task" }, { provider: "mock", model: "default" }),
  );
  const failed = runRecordSchema.parse({
    ...finishAttempt(startAttempt(pending, "build"), "build", "failed"),
    status: "failed",
  });
  const attemptId = failed.steps[0]?.attempts[0]?.id;
  if (!attemptId) throw new Error("Missing attempt");
  const onRetry =
    vi.fn<(stepId: string, attemptId: string, focusTarget?: HTMLElement | null) => void>();
  render(
    <RunInspector
      run={failed}
      scope={{ kind: "step", stepId: "build", attemptId }}
      onScopeChange={vi.fn<(scope: RunScope) => void>()}
      onClose={vi.fn<() => void>()}
      connected
      onRetry={onRetry}
    />,
  );
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Retry…" });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Retry Build?" });
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.tab();
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(screen.getByText(/Create Attempt 2 for Build/)).toBeTruthy();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Start Attempt 2" }));
  // The inspector trigger is the focus target for a follow-up permission dialog.
  expect(onRetry).toHaveBeenCalledExactlyOnceWith("build", attemptId, trigger);
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
