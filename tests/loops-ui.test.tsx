// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createLoopDraft, parseLoop, type LoopDefinition } from "../src/domain/loop.js";
import { exportPortableLoop } from "../src/domain/loop-portable.js";
import type { AgentConnection } from "../src/adapters/contract.js";
import { Loops } from "../src/ui/Loops.js";
import { LoopEditor } from "../src/ui/LoopEditor.js";
import { NativeTranslation } from "../src/ui/NativeTranslation.js";
import { setParallelGroup } from "../src/ui/loop-editor-model.js";
import type { ProjectResponse } from "../src/ui/project-api.js";

const project: ProjectResponse = {
  project: { schemaVersion: 1, name: "Project", defaultBinding: null },
  path: "/project",
  revision: "one",
};
function draft(): LoopDefinition {
  return parseLoop({
    ...createLoopDraft("sample", "Sample"),
    steps: [
      {
        id: "build",
        name: "Build",
        kind: "agent",
        stage: "implementation",
        role: "Builder",
        instruction: "Build it",
        expectedOutputs: ["Patch"],
      },
      {
        id: "review",
        name: "Review",
        kind: "agent",
        stage: "review",
        role: "Reviewer",
        instruction: "Review it",
        expectedOutputs: ["Receipt"],
      },
    ],
    dependencies: [{ from: "build", to: "review" }],
  });
}
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
        formats: [{ format: "cursor-rule-mdc", provider: "cursor", label: "Cursor project rule" }],
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

describe("loops library UI", () => {
  it("stays blank until a starter is chosen and saves the full staged starter as a draft", async () => {
    const user = userEvent.setup();
    const requests: { path: string; method: string; body?: LoopDefinition }[] = [];
    vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
      const method = options?.method ?? "GET";
      const body = options?.body ? (JSON.parse(String(options.body)) as LoopDefinition) : undefined;
      requests.push({ path, method, ...(body ? { body } : {}) });
      if (path === "/api/loops" && method === "GET") return Response.json({ loops: [] });
      if (path.endsWith("/draft") && method === "PUT" && body) return Response.json({ loop: body });
      throw new Error(`Unexpected ${method} ${path}`);
    });
    render(<Loops project={project} agents={[]} />);
    expect(await screen.findByRole("heading", { name: "No user loops yet" })).toBeTruthy();
    expect(requests).toEqual([{ path: "/api/loops", method: "GET" }]);
    await user.click(screen.getByRole("button", { name: "Use starter template" }));
    const chooser = screen.getByLabelText("Starter templates");
    expect(
      within(chooser).getByRole("heading", { name: /Implement.*Review.*Validate/ }),
    ).toBeTruthy();
    await user.click(within(chooser).getAllByRole("button", { name: "Create draft" })[1]!);
    await waitFor(() => expect(requests.some((request) => request.method === "PUT")).toBe(true));
    const saved = requests.find((request) => request.method === "PUT")!.body!;
    expect(saved.status).toBe("draft");
    expect(saved.steps).toHaveLength(16);
    expect(saved.steps.filter((step) => step.stage === "review")).toHaveLength(6);
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("validates a portable import before an explicit confirmation saves a new draft", async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
      const method = options?.method ?? "GET";
      requests.push(`${method} ${path}`);
      if (path === "/api/loops" && method === "GET") return Response.json({ loops: [] });
      if (path.endsWith("/draft") && method === "PUT")
        return Response.json({ loop: JSON.parse(String(options?.body)) });
      throw new Error(`Unexpected ${method} ${path}`);
    });
    render(<Loops project={project} agents={[]} />);
    await screen.findByRole("heading", { name: "No user loops yet" });
    await user.click(screen.getByRole("button", { name: "Import JSON" }));
    const input = screen.getByRole("textbox", { name: "Paste a portable loop document" });
    fireEvent.change(input, { target: { value: "{" } });
    await user.click(screen.getByRole("button", { name: "Validate import" }));
    expect(screen.getByRole("alert").textContent).toMatch(/JSON:/);
    expect(requests).toEqual(["GET /api/loops"]);
    fireEvent.change(input, { target: { value: exportPortableLoop(draft()) } });
    await user.click(screen.getByRole("button", { name: "Validate import" }));
    expect(screen.getByText(/Valid draft with 2 steps/)).toBeTruthy();
    expect(requests).toEqual(["GET /api/loops"]);
    await user.click(screen.getByRole("button", { name: "Confirm import: Sample" }));
    await waitFor(() => expect(requests.some((request) => request.startsWith("PUT "))).toBe(true));
  });

  it("reports a newly published loop to the factory run intake", async () => {
    const user = userEvent.setup();
    const agent: AgentConnection = {
      provider: "codex",
      executable: "/bin/codex",
      installation: "detected",
      authentication: "authenticated",
      protocol: "app-server",
      version: "test",
      identity: "codex",
      capabilities: { streaming: "supported", steering: "unknown", resume: "unknown" },
      models: [{ id: "agent-default", displayName: "Default" }],
    };
    const published = parseLoop({ ...draft(), status: "published" });
    const onPublished = vi.fn<(loop: LoopDefinition) => void>();
    vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
      if (path === "/api/loops")
        return Response.json({ loops: [{ id: "sample", draft: draft(), published: null }] });
      if (path === "/api/loops/sample/draft" && options?.method === "PUT")
        return Response.json({ loop: draft() });
      if (path === "/api/loops/sample/publish" && options?.method === "POST")
        return Response.json({ loop: published });
      throw new Error(`Unexpected ${options?.method ?? "GET"} ${path}`);
    });
    render(
      <Loops
        project={{
          ...project,
          project: {
            ...project.project!,
            defaultBinding: { provider: "codex", model: "agent-default" },
          },
        }}
        agents={[agent]}
        onPublished={onPublished}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Edit draft" }));
    await user.click(screen.getByRole("button", { name: "Publish v1" }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith(published));
  });
  it("shows saved draft and published content separately", async () => {
    const published = parseLoop({ ...draft(), name: "Published plan", status: "published" });
    vi.stubGlobal("fetch", async () =>
      Response.json({ loops: [{ id: "sample", draft: draft(), published, versions: [1] }] }),
    );
    render(<Loops project={project} agents={[]} />);
    expect(await screen.findByRole("heading", { name: "Published plan" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sample" })).toBeTruthy();
    expect(screen.getByText("Published v1")).toBeTruthy();
  });
  it("restores drawer focus and offers a keyboard semantic move with undo and redo", async () => {
    const user = userEvent.setup();
    let stored = draft();
    const requests: { method: string; body?: LoopDefinition }[] = [];
    vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
      const method = options?.method ?? "GET";
      requests.push({
        method,
        ...(options?.body ? { body: JSON.parse(String(options.body)) as LoopDefinition } : {}),
      });
      if (path === "/api/loops" && method === "GET")
        return Response.json({ loops: [{ id: "sample", draft: stored, published: null }] });
      if (path === "/api/loops/sample/draft" && method === "PUT") {
        stored = JSON.parse(String(options?.body)) as LoopDefinition;
        return Response.json({ loop: stored });
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });
    render(<Loops project={project} agents={[]} />);
    await user.click(await screen.findByRole("button", { name: "Edit draft" }));
    const build = screen.getByRole("button", { name: "Build" });
    build.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Step configuration" })).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: "Title" })).toBe(
      document.activeElement,
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(build).toBe(document.activeElement));
    screen.getByRole("radio", { name: "Move Review" }).focus();
    await user.keyboard(" ");
    expect((screen.getByRole("radio", { name: "Move Review" }) as HTMLInputElement).checked).toBe(
      true,
    );
    screen.getByRole("button", { name: "before Build" }).focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(stored.dependencies).toEqual([{ from: "review", to: "build" }]));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(stored.dependencies).toEqual([{ from: "build", to: "review" }]));
    await user.click(screen.getByRole("button", { name: "Redo" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(stored.dependencies).toEqual([{ from: "review", to: "build" }]));
    expect(requests.filter((item) => item.method === "PUT")).toHaveLength(3);
  });
  it("blocks publication of an unbound definition before sending a publish request", async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (path: string) => {
      paths.push(path);
      if (path === "/api/loops")
        return Response.json({ loops: [{ id: "sample", draft: draft(), published: null }] });
      if (path === "/api/native/formats") return Response.json({ formats: [] });
      throw new Error(`Unexpected ${path}`);
    });
    render(<Loops project={project} agents={[]} />);
    await user.click(await screen.findByRole("button", { name: "Edit draft" }));
    await user.click(screen.getByRole("button", { name: "Publish v1" }));
    expect(screen.getByRole("alert").textContent).toMatch(/project default or step binding/);
    expect(paths).toEqual(["/api/loops", "/api/native/formats"]);
  });
  it("shows an unsupported project model and blocks publication", async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    const agent: AgentConnection = {
      provider: "codex",
      executable: "/bin/codex",
      installation: "detected",
      authentication: "authenticated",
      protocol: "app-server",
      version: "test",
      identity: "codex",
      capabilities: { streaming: "supported", steering: "unknown", resume: "unknown" },
      models: [{ id: "agent-default", displayName: "Default" }],
    };
    vi.stubGlobal("fetch", async (path: string) => {
      paths.push(path);
      if (path === "/api/loops")
        return Response.json({ loops: [{ id: "sample", draft: draft(), published: null }] });
      if (path === "/api/native/formats") return Response.json({ formats: [] });
      throw new Error(`Unexpected ${path}`);
    });
    render(
      <Loops
        project={{
          ...project,
          project: {
            ...project.project!,
            defaultBinding: { provider: "codex", model: "old-model" },
          },
        }}
        agents={[agent]}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Edit draft" }));
    await user.click(screen.getByRole("button", { name: "Publish v1" }));
    expect(screen.getByRole("alert").textContent).toMatch(/old-model.*unavailable/);
    expect(paths).toEqual(["/api/loops", "/api/native/formats"]);
  });
  it("shows semantic group membership on the board and restores focus when undo removes an open step", async () => {
    const user = userEvent.setup();
    const grouped = setParallelGroup(
      parseLoop({ ...draft(), dependencies: [] }),
      ["build", "review"],
      "Reviews",
    );
    vi.stubGlobal("fetch", async (path: string) => {
      if (path === "/api/loops")
        return Response.json({ loops: [{ id: "sample", draft: grouped, published: null }] });
      throw new Error(`Unexpected ${path}`);
    });
    render(<Loops project={project} agents={[]} />);
    await user.click(await screen.findByRole("button", { name: "Edit draft" }));
    expect(screen.getAllByText("agent · parallel: Reviews")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "+ Agent step" }));
    await user.click(screen.getByRole("button", { name: "New agent step" }));
    expect(screen.getByRole("dialog", { name: "Step configuration" })).toBeTruthy();
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "← Loops" })).toBe(document.activeElement),
    );
  });
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
      capabilities: { streaming: "supported", steering: "unknown", resume: "unknown" },
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
