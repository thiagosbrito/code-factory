// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseLoop } from "../src/domain/loop.js";
import { type AgentConnection } from "../src/adapters/contract.js";
import { LoopEditor } from "../src/ui/features/loops/LoopEditor.js";
import { draft, project } from "./support/loops-ui.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("loops library UI", () => {
  it("locks the editor while publication is pending and publishes the captured definition once", async () => {
    const user = userEvent.setup();
    const initial = draft();
    const published = parseLoop({ ...initial, status: "published" });
    const agent: AgentConnection = {
      provider: "codex",
      executable: "/bin/codex",
      installation: "detected",
      authentication: "authenticated",
      protocol: "app-server",
      version: "test",
      identity: "codex",
      capabilities: {
        streaming: "supported",
        steering: "unknown",
        resume: "unknown",
        pause: "unsupported",
        waitingInput: "unknown",
      },
      models: [{ id: "agent-default", displayName: "Default" }],
    };
    let finishSave!: (response: Response) => void;
    const pendingSave = new Promise<Response>((resolve) => {
      finishSave = resolve;
    });
    const requests: string[] = [];
    vi.stubGlobal("fetch", (path: string, options?: RequestInit) => {
      requests.push(`${options?.method} ${path}`);
      if (path === "/api/native/formats") return Promise.resolve(Response.json({ formats: [] }));
      if (path.endsWith("/draft")) return pendingSave;
      if (path.endsWith("/publish")) return Promise.resolve(Response.json({ loop: published }));
      throw new Error(`Unexpected ${path}`);
    });
    render(
      <LoopEditor
        initial={initial}
        project={{
          ...project,
          project: {
            ...project.project!,
            defaultBinding: { provider: "codex", model: "agent-default" },
          },
        }}
        agents={[agent]}
        onBack={() => undefined}
        onPublished={async () => undefined}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Publish v1" }));
    expect(screen.getByRole("textbox", { name: "Loop title" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "+ Agent step" }).matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(true);
    await user.keyboard("{Control>}z{/Control}");
    expect(requests).toEqual(["undefined /api/native/formats", "PUT /api/loops/sample/draft"]);
    finishSave(Response.json({ loop: initial }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish v2" })).toBeTruthy());
    expect((screen.getByRole("textbox", { name: "Loop title" }) as HTMLInputElement).value).toBe(
      "Sample",
    );
    expect(requests).toEqual([
      "undefined /api/native/formats",
      "PUT /api/loops/sample/draft",
      "POST /api/loops/sample/publish",
    ]);
  });

  it("resets join and decision controls when undo changes the selected step graph", async () => {
    const user = userEvent.setup();
    const initial = parseLoop({
      ...draft(),
      dependencies: [],
      steps: [
        ...draft().steps,
        {
          id: "validate",
          name: "Validate",
          kind: "check",
          stage: "validation",
          role: "Checker",
          instruction: "Check",
          expectedOutputs: ["Result"],
        },
      ],
    });
    render(
      <LoopEditor
        initial={initial}
        project={project}
        agents={[]}
        onBack={() => undefined}
        onPublished={async () => undefined}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Validate" }));
    expect(document.body.style.pointerEvents).toBe("none");
    await user.click(within(screen.getByRole("dialog")).getByRole("checkbox", { name: "Build" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("checkbox", { name: "Review" }));
    await user.click(screen.getByRole("button", { name: "Set join" }));
    expect(
      within(screen.getByRole("dialog"))
        .getByRole("checkbox", { name: "Build" })
        .matches(":checked"),
    ).toBe(true);
    await user.keyboard("{Control>}z{/Control}");
    expect(
      within(screen.getByRole("dialog"))
        .getByRole("checkbox", { name: "Build" })
        .matches(":checked"),
    ).toBe(false);
    expect(
      within(screen.getByRole("dialog"))
        .getByRole("checkbox", { name: "Review" })
        .matches(":checked"),
    ).toBe(false);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Build" }));
    await user.selectOptions(
      within(screen.getByRole("dialog")).getByRole("combobox", { name: "First target" }),
      "review",
    );
    await user.selectOptions(
      within(screen.getByRole("dialog")).getByRole("combobox", { name: "Second target" }),
      "validate",
    );
    await user.click(screen.getByRole("button", { name: "Set decision" }));
    await user.keyboard("{Control>}z{/Control}");
    expect(
      (
        within(screen.getByRole("dialog")).getByRole("combobox", {
          name: "First target",
        }) as HTMLSelectElement
      ).value,
    ).toBe("");
    expect(
      (
        within(screen.getByRole("dialog")).getByRole("combobox", {
          name: "Second target",
        }) as HTMLSelectElement
      ).value,
    ).toBe("");
  });

  it("drops deleted steps from a pending group selection", async () => {
    const user = userEvent.setup();
    render(
      <LoopEditor
        initial={draft()}
        project={project}
        agents={[]}
        onBack={() => undefined}
        onPublished={async () => undefined}
      />,
    );
    await user.click(screen.getByRole("button", { name: "+ Agent step" }));
    await user.type(screen.getByRole("textbox", { name: "Group name" }), "Review team");
    for (const name of ["Build", "Review", "New agent step"])
      await user.click(screen.getByRole("checkbox", { name }));
    await user.click(screen.getByRole("button", { name: "New agent step" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete step" }),
    );
    await user.click(screen.getByRole("button", { name: "Create parallel group" }));
    expect(screen.getAllByText("agent · parallel: Review team")).toHaveLength(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
