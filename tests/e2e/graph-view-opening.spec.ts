import { expect } from "@playwright/test";
import { finishSetup, test } from "./support/editor-run.js";
import { dependency, openStarterInGraph, selectDependency, zoomOf } from "./support/graph.js";

test.use({ viewport: { width: 1600, height: 1200 } });

const MIN_OPENING_ZOOM = 0.6;

test("opening and closing the Graph view on a loop with a group, join and decision sends no write", async ({
  page,
  harness,
}) => {
  // The staged starter has parallel groups, joins and decisions.
  await openStarterInGraph(page, harness.origin, 1);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/") && request.method() !== "GET")
      writes.push(`${request.method()} ${request.url()}`);
  });
  await page.getByRole("button", { name: "Board" }).click();
  await page.getByRole("button", { name: "Graph" }).click();
  await expect(page.locator(".react-flow__node-step").first()).toBeVisible();
  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
  expect(writes).toEqual([]);
});

test("a 30-step loop opens at a readable zoom", async ({ page, harness }) => {
  await finishSetup(page, harness.origin);
  const steps = Array.from({ length: 30 }, (_, index) => ({
    id: `step-${String(index).padStart(2, "0")}`,
    name: `Step ${index}`,
    kind: "agent",
    stage: "implementation",
    role: "Worker",
    instruction: "Do the work.",
    expectedOutputs: ["Result"],
  }));
  const saved = await page.evaluate(async (loopSteps) => {
    const response = await fetch("/api/loops/big-loop/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 2,
        id: "big-loop",
        name: "Big loop",
        version: 1,
        status: "draft",
        steps: loopSteps,
        dependencies: [],
        groups: [],
        joins: [],
        decisions: [],
        policy: { maxAttemptsPerStep: 3, maxImplementationRounds: 2 },
      }),
    });
    return response.status;
  }, steps);
  expect(saved).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Edit draft" }).first().click();
  await page.getByRole("button", { name: "Graph" }).click();
  await expect(page.locator(".react-flow__node-step").first()).toBeVisible();
  expect(await zoomOf(page)).toBeGreaterThanOrEqual(MIN_OPENING_ZOOM - 0.001);
  // Anchored at the top-left: the first step and the first lane are on screen.
  await expect(page.getByRole("heading", { name: "1. Evidence" })).toBeInViewport();
  await expect(page.getByRole("group", { name: /^Step 0, / })).toBeInViewport();
});

test("a small loop still fits whole and is not enlarged past 1:1", async ({ page, harness }) => {
  await openStarterInGraph(page, harness.origin);
  const zoom = await zoomOf(page);
  expect(zoom).toBeGreaterThanOrEqual(MIN_OPENING_ZOOM - 0.001);
  expect(zoom).toBeLessThanOrEqual(1);
  await expect(page.getByRole("heading", { name: "5. Validate" })).toBeInViewport();
});

test("edge animation is suppressed under reduced motion and runs without it", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  const animationOf = () =>
    dependency(page, "Implement", "Review")
      .locator(".react-flow__edge-path")
      .evaluate((path) => {
        // Give the edge the library's animated class: the app never sets it, but if it ever
        // did (or a library default did), the stylesheet decides whether it may move.
        path.closest(".react-flow__edge")?.classList.add("animated");
        return getComputedStyle(path).animationName;
      });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await animationOf()).not.toBe("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animationOf()).toBe("none");
});

test("selecting a connection by clicking its curve shows its delete control", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  await selectDependency(page, "Review", "Validate");
  await expect(
    page.getByRole("button", { name: "Delete: Dependency from Review to Validate" }),
  ).toBeVisible();
});
