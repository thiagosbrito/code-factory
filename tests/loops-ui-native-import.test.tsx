// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createLoopDraft, parseLoop } from "../src/domain/loop.js";
import { NativeTranslation } from "../src/ui/features/loops/NativeTranslation.js";
import { importerGeneratedRole } from "../src/translators/contract.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("previews native import losses and waits for explicit application", async () => {
  const user = userEvent.setup();
  const imported = parseLoop({
    ...createLoopDraft("native", "Native"),
    steps: [{ id: "rule", name: "Review", kind: "agent", role: "", instruction: "Review code" }],
  });
  const requests: string[] = [];
  let appliedRevision = "";
  vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
    requests.push(path);
    if (path === "/api/native/formats")
      return Response.json({
        formats: [
          {
            format: "cursor-rule-mdc",
            provider: "cursor",
            label: "Cursor project rule",
            directions: ["import", "export"],
          },
        ],
      });
    if (path.startsWith("/api/native/candidates")) return Response.json({ names: ["review"] });
    if (path === "/api/native/import/preview" || path === "/api/native/import/apply") {
      const body = JSON.parse(String(options?.body)) as { expectedRevision?: string };
      if (path.endsWith("/apply")) appliedRevision = body.expectedRevision ?? "";
      return Response.json({
        relativePath: ".cursor/rules/review.mdc",
        revision: "revision-1",
        direction: "import",
        conflicts: [],
        report: {
          issues: [{ field: "alwaysApply", kind: "unsupported", message: "Activation omitted" }],
        },
        loop: imported,
      });
    }
    throw new Error(`Unexpected ${path}`);
  });
  const apply = vi.fn<() => boolean>(() => true);
  render(
    <NativeTranslation loop={createLoopDraft("native", "Native")} apply={apply} disabled={false} />,
  );
  await screen.findByRole("option", { name: "Cursor project rule" });
  fireEvent.change(screen.getByRole("combobox", { name: "Configuration name" }), {
    target: { value: "review" },
  });
  await user.click(screen.getByRole("button", { name: "Preview" }));
  expect(await screen.findByText(/Affected path:/)).toBeTruthy();
  expect(screen.getByText(/unsupported: alwaysApply/)).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Apply import" }));
  await waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(appliedRevision).toBe("revision-1");
  expect(requests).toContain("/api/native/import/apply");
});

it("marks Kiro workflows import-only and summarizes a multi-step import", async () => {
  const user = userEvent.setup();
  const exitInstruction = "Importer-generated pass-through step. Reply with one line.";
  const agent = (id: string, name: string, groupId?: string) => ({
    id,
    name,
    kind: "agent",
    role: "wf-coder",
    instruction: `${name}.`,
    ...(groupId ? { groupId } : {}),
  });
  const imported = parseLoop({
    ...createLoopDraft("native", "Native"),
    steps: [
      agent("prepare", "Prepare"),
      agent("domain-context", "Domain context", "gather-context"),
      agent("ui-test-context", "Ui test context", "gather-context"),
      {
        id: "rounds-exit",
        name: "Rounds exit (importer generated)",
        kind: "agent",
        role: importerGeneratedRole,
        instruction: exitInstruction,
      },
    ],
    dependencies: [
      { from: "prepare", to: "domain-context" },
      { from: "prepare", to: "ui-test-context" },
      { from: "ui-test-context", to: "rounds-exit" },
    ],
    groups: [
      {
        id: "gather-context",
        name: "Gather context",
        kind: "parallel",
        stepIds: ["domain-context", "ui-test-context"],
      },
    ],
  });
  let previews = 0;
  vi.stubGlobal("fetch", async (path: string) => {
    if (path === "/api/native/formats")
      return Response.json({
        formats: [
          {
            format: "cursor-rule-mdc",
            provider: "cursor",
            label: "Cursor project rule",
            directions: ["import", "export"],
          },
          {
            format: "kiro-workflow-json",
            provider: "kiro",
            label: "Kiro workflow",
            directions: ["import"],
          },
        ],
      });
    if (path.startsWith("/api/native/candidates")) return Response.json({ names: ["focused"] });
    if (path === "/api/native/import/preview") {
      previews++;
      if (previews > 1)
        return Response.json(
          { error: "Import requires an empty draft to preserve existing steps." },
          { status: 422 },
        );
      return Response.json({
        relativePath: ".kiro/workflows/focused.workflow.json",
        revision: "revision-1",
        direction: "import",
        conflicts: [],
        report: {
          issues: [
            {
              field: "steps[3].steps[3].steps[0].joinPolicy",
              kind: "lossy",
              message: "allSettled imported as all; a failed branch now blocks the join.",
            },
          ],
        },
        loop: imported,
      });
    }
    throw new Error(`Unexpected ${path}`);
  });
  render(
    <NativeTranslation
      loop={createLoopDraft("native", "Native")}
      apply={() => true}
      disabled={false}
    />,
  );
  await screen.findByRole("option", { name: "Kiro workflow" });
  const exportOption = screen.getByRole("option", { name: "Export" });
  expect(exportOption).toHaveProperty("disabled", false);
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Native format" }),
    "Kiro workflow",
  );
  expect(exportOption).toHaveProperty("disabled", true);
  expect(screen.getByText("Kiro workflow is import-only.")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Configuration name" }), {
    target: { value: "focused" },
  });
  await user.click(screen.getByRole("button", { name: "Preview" }));
  expect(
    await screen.findByText(/lossy: steps\[3\]\.steps\[3\]\.steps\[0\]\.joinPolicy/),
  ).toBeTruthy();
  expect(
    screen.getByText("Imported draft: 4 steps, 1 group, 1 generated by the importer"),
  ).toBeTruthy();
  // A multi-step import no longer names only its first step.
  expect(screen.queryByText(/Imported draft step:/)).toBeNull();
  expect(screen.getByRole("heading", { name: "Imported steps" })).toBeTruthy();
  const list = screen.getByRole("list", { name: "Imported steps" });
  const items = within(list).getAllByRole("listitem");
  expect(items.map((item) => item.querySelector("summary")?.textContent)).toEqual([
    "Prepare",
    "Domain context",
    "Ui test context",
    "Rounds exit (importer generated)Generated by importer",
  ]);
  const [first, , , generated] = items;
  if (!first || !generated) throw new Error("Expected four imported steps.");
  expect(within(first).queryByText("Generated by importer")).toBeNull();
  // Each instruction is readable before apply, behind a keyboard-operable disclosure.
  const exitDetails = generated.querySelector("details");
  expect(exitDetails?.open).toBe(false);
  expect(within(generated).getByText(exitInstruction)).toBeTruthy();
  // Native <summary> is focusable and toggles on Enter/Space in browsers; jsdom models
  // only the click activation, so the toggle is exercised through a click here.
  const summary = generated.querySelector("summary");
  if (!summary) throw new Error("Expected a disclosure summary.");
  await user.click(summary);
  expect(exitDetails?.open).toBe(true);
  await user.click(screen.getByRole("button", { name: "Preview" }));
  expect(
    await screen.findByText("Import requires an empty draft to preserve existing steps."),
  ).toBeTruthy();
});
