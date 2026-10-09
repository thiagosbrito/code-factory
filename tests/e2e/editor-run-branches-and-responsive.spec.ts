import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { executeWithDefaultTools, finishSetup, runProgress, test } from "./support/editor-run.js";

test("a run changes the project folder itself on a new branch, is promoted, and switches back", async ({
  page,
  harness,
}) => {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: harness.projectDirectory, encoding: "utf8" }).trim();
  const userHead = git("rev-parse", "HEAD");
  const userBranch = git("symbolic-ref", "HEAD");
  await finishSetup(page, harness.origin);
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Use starter template" }).click();
  await page
    .getByLabel("Starter templates")
    .getByRole("button", { name: "Create draft" })
    .first()
    .click();
  await page.getByRole("button", { name: "Publish v1" }).click();
  await page.getByRole("button", { name: "Runs" }).click();
  await page.getByRole("button", { name: /New run/i }).click();
  await page.getByLabel(/Task description/).fill("Promote the run branch");
  await page.getByRole("button", { name: "Start run" }).click();

  const execute = page.getByRole("button", { name: "Execute run" });
  await execute.click();
  const prompt = page.getByRole("dialog", {
    name: "Allow Codex to run commands outside its sandbox?",
  });
  await expect(prompt).toContainText("network access and writes outside the project");
  await expect(prompt.getByRole("button", { name: "Cancel" })).toBeFocused();
  await prompt.getByRole("button", { name: "Allow and run" }).click();
  await expect(prompt).toHaveCount(0);
  // The grant lives in the user's trust store, never in the project's own files.
  const project = (await (await page.request.get(`${harness.origin}/api/project`)).json()) as {
    trust: { toolGrants: { codex?: { scope: string[] } } };
  };
  expect(project.trust.toolGrants.codex?.scope).toEqual(["commandExecution"]);
  const config = JSON.parse(
    await readFile(join(harness.projectDirectory, ".code-factory", "project.json"), "utf8"),
  ) as { toolGrants?: unknown };
  expect(config.toolGrants).toBeUndefined();

  // The run branch shows in the header; its panel opens from the floating icon over the canvas.
  await expect(page.getByText(/^code-factory\/[0-9a-f]{8}$/)).toBeVisible();
  const graph = page.getByRole("region", { name: "Execution graph" });
  const runBranch = page.getByRole("dialog", { name: "Run branch" });
  await runProgress
    .poll(async () => {
      const body = (await (await page.request.get(`${harness.origin}/api/runs`)).json()) as {
        runs: { status: string }[];
      };
      return body.runs[0]?.status;
    })
    .toBe("succeeded");
  const runs = (await (await page.request.get(`${harness.origin}/api/runs`)).json()) as {
    runs: { snapshot: { id: string; baseline: { branch: string } } }[];
  };
  const branch = runs.runs[0]?.snapshot.baseline.branch ?? "";
  expect(git("log", "-1", "--format=%B", branch)).toContain("Code-Factory-Step: implement");
  // The user's own checkout is on the run branch and holds the agent's change: no worktree, no copy.
  expect(git("symbolic-ref", "HEAD")).toBe(`refs/heads/${branch}`);
  expect(await readFile(join(harness.projectDirectory, "fixture-output.txt"), "utf8")).toBe(
    "fixture change\n",
  );
  expect(git("worktree", "list").split("\n")).toHaveLength(1);
  expect(git("status", "--porcelain", "--", ".", ":(exclude).code-factory")).toBe("");
  // Neither the page nor the graph scrolls sideways: the graph opens fitted to its canvas.
  const overflow = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".run-graph-canvas");
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      graph: canvas ? canvas.scrollWidth - canvas.clientWidth : -1,
    };
  });
  expect(overflow).toEqual({ page: 0, graph: 0 });
  const previous = userBranch.replace("refs/heads/", "");
  await graph.getByRole("button", { name: "Run branch" }).click();
  await expect(runBranch).toContainText(
    `Your project checkout is on this branch (it was on ${previous}).`,
  );

  const create = runBranch.getByRole("button", { name: "Create ticket branch" });
  await expect(create).toBeDisabled();
  await expect(runBranch).toContainText("Accept the evidence before creating a ticket branch.");
  await page.keyboard.press("Escape");
  await expect(graph.getByRole("button", { name: "Run branch" })).toBeFocused();
  await page.getByRole("button", { name: "Accept evidence" }).click();
  await expect(page.getByText(/Human acceptance:/)).toContainText("accepted");
  await graph.getByRole("button", { name: "Run branch" }).click();
  await expect(create).toBeEnabled();
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Create ticket branch" });
  const name = dialog.getByRole("textbox", { name: "Branch name" });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("");
  await name.fill("demo-run");
  await dialog.getByRole("button", { name: "Create branch" }).click();
  await expect(runBranch).toContainText("Ticket branch demo-run");
  // The trigger is gone after success, so focus lands on the result instead of the page body.
  await expect(runBranch.getByText(/^Ticket branch demo-run at/)).toBeFocused();
  expect(git("rev-list", "demo-run")).toBe(git("rev-list", branch));
  expect(git("symbolic-ref", "HEAD")).toBe(`refs/heads/${branch}`);

  // "Back to <branch>" restores the user's checkout; the run's commits stay on its branches.
  await runBranch.getByRole("button", { name: `Back to ${previous}` }).click();
  await expect(runBranch).toContainText(`Your project checkout is now on ${previous}`);
  expect(git("symbolic-ref", "HEAD")).toBe(userBranch);
  expect(git("rev-parse", "HEAD")).toBe(userHead);
  await expect(access(join(harness.projectDirectory, "fixture-output.txt"))).rejects.toThrow();
  expect(git("log", "-1", "--format=%B", branch)).toContain("Code-Factory-Step: implement");
  await page.keyboard.press("Escape");
  await expect(runBranch).toHaveCount(0);

  // Revoke from Setup: the grant leaves project.json and focus moves to the new Allow… button.
  await page
    .getByRole("navigation", { name: "Factory" })
    .getByRole("button", { name: "Settings" })
    .click();
  await page.getByRole("button", { name: "Edit project setup" }).click();
  await page.getByRole("button", { name: "Revoke Codex command permission" }).click();
  const allow = page.getByRole("button", { name: "Allow Codex command permission…" });
  await expect(allow).toBeFocused();
  const revoked = JSON.parse(
    await readFile(join(harness.projectDirectory, ".code-factory", "project.json"), "utf8"),
  ) as { toolGrants?: unknown };
  expect(revoked.toolGrants).toBeUndefined();
});

test("a blocked review stops the run, and retrying it from the banner reaches adjudication", async ({
  page,
  harness,
}) => {
  harness.setBlockFirstTestReview(true);
  await finishSetup(page, harness.origin);
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Use starter template" }).click();
  await page
    .getByLabel("Starter templates")
    .getByRole("button", { name: "Create draft" })
    .nth(1)
    .click();
  await page.getByRole("button", { name: "Publish v1" }).click();
  await page.getByRole("button", { name: "Runs" }).click();
  await page.getByRole("button", { name: /New run/i }).click();
  await page.getByLabel(/Task description/).fill("Recover a blocked review");
  await page.getByRole("button", { name: "Start run" }).click();
  await executeWithDefaultTools(page);
  harness.releaseReviews();
  const status = async () => {
    const body = (await (await page.request.get(`${harness.origin}/api/runs`)).json()) as {
      runs: { status: string }[];
    };
    return body.runs[0]?.status;
  };
  await runProgress.poll(status).toBe("blocked");

  const banner = page.getByRole("region", { name: "Test quality review blocked the run" });
  await expect(banner).toContainText("Cannot run pnpm test: shell refused.");
  await runProgress(
    page.getByRole("button", { name: /^Verify and adjudicate, Not reached/ }),
  ).toBeVisible();
  await banner.getByRole("button", { name: "Retry Test quality review" }).click();
  // The banner unmounts once the run resumes; focus stays on the run title.
  await expect(
    page.getByRole("heading", { level: 2, name: "Recover a blocked review" }),
  ).toBeFocused();
  await runProgress.poll(status).toBe("succeeded");
  await expect(banner).toHaveCount(0);
  await runProgress(
    page.getByRole("button", { name: /^Verify and adjudicate, succeeded/ }),
  ).toBeVisible();
  await runProgress(
    page.getByRole("button", { name: /^Test quality review, succeeded, 2 attempts/ }),
  ).toBeVisible();
});

test("select controls remain usable at mobile width and with reduced motion", async ({
  page,
  harness,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(harness.origin);
  await page.getByRole("textbox", { name: "Project name" }).fill("Mobile project");
  await page.getByRole("button", { name: /Codex.*Executable detected/ }).click();
  await page.getByRole("button", { name: "Verify connection" }).click();
  const model = page.getByRole("combobox", { name: "Project default model" });
  await model.scrollIntoViewIfNeeded();
  await expect(model).toBeInViewport();
  await model.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Connect your first project" })).toBeVisible();
  await expect(model).toBeFocused();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Create empty loop" }).first().click();
  await page.getByRole("button", { name: "+ Agent step" }).click();
  await page.getByRole("button", { name: "New agent step", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Step configuration" });
  for (const name of ["Step coding agent", "Join mode"]) {
    const select = drawer.getByRole("combobox", { name });
    await select.scrollIntoViewIfNeeded();
    await expect(select).toBeInViewport();
    await expect(select).toBeEnabled();
  }
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
});
