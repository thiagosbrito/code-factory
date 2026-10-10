import { expect } from "@playwright/test";
import { test } from "./support/editor-run.js";
import { connect, dependency, openStarterInGraph, stepNode } from "./support/graph.js";

// A tall, wide window keeps the whole canvas on screen at a readable zoom for real pointer drags.
test.use({ viewport: { width: 1600, height: 1200 } });

// The staged starter is Board-authored: a parallel group, an "all" join, a repeat group and a decision.
const DOMAIN = "Domain and API evidence";
const UI = "UI and test evidence";
const PLAN = "Design and plan";
const ADJUDICATE = "Verify and adjudicate";

const expectUntouched = async (page: import("@playwright/test").Page) => {
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
};

test("groups, joins and decisions are drawn in the Graph view without writing to the draft", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin, 1);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/") && request.method() !== "GET")
      writes.push(`${request.method()} ${request.url()}`);
  });
  // One labelled region per group: dashed parallel, solid repeat.
  const parallel = page.getByText("Parallel group: Parallel evidence");
  await expect(parallel).toBeVisible();
  await expect(parallel.locator("xpath=..")).toHaveClass(/graph-region-parallel/);
  const repeat = page.getByText(/^Repeat group: Implementation and three review pairs/);
  await expect(repeat).toBeVisible();
  await expect(repeat.locator("xpath=..")).toHaveClass(/graph-region-repeat/);
  // The join's mode sits on its target; the join's incoming edges are drawn apart.
  await expect(stepNode(page, PLAN).getByText("waits for all", { exact: true })).toBeVisible();
  await expect(dependency(page, DOMAIN, PLAN)).toHaveClass(/graph-edge-join/);
  // The decision shows its outcome on the branch and the repeat's continuation is a view-only arrow.
  await expect(stepNode(page, ADJUDICATE).getByText("decision: pass / repair")).toBeVisible();
  await expect(page.locator(".graph-outcome-label", { hasText: "pass" })).toBeVisible();
  const arrow = page.locator('.react-flow__edge[aria-label^="Repeat group Implementation"]');
  await expect(arrow).toHaveCount(1);
  await expect(page.locator(".graph-continue-label")).toHaveText("repair (repeat)");
  await page.getByRole("button", { name: "Board" }).click();
  await page.getByRole("button", { name: "Graph" }).click();
  await expect(parallel).toBeVisible();
  await expectUntouched(page);
  expect(writes).toEqual([]);
});

test("a connection that touches a constrained step is disabled or refused with its reason", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin, 1);
  // A decision cannot start a plain connection: the handle says why up front.
  const handle = stepNode(page, ADJUDICATE).locator(".react-flow__handle.source");
  await expect(handle).toHaveAttribute("aria-disabled", "true");
  await expect(handle).toHaveAttribute(
    "title",
    /Decision step: add a named branch in the Board view/,
  );
  // Members of a parallel group cannot be ordered: the refusal explains and nothing changes.
  await connect(page, DOMAIN, UI);
  await expect(
    page.getByRole("alert").filter({ hasText: "cannot order its members" }),
  ).toBeVisible();
  await expect(dependency(page, DOMAIN, UI)).toHaveCount(0);
  await expectUntouched(page);
});

test("removing a join source asks first: Cancel changes nothing, Confirm is one undo entry", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin, 1);
  const remove = async () => {
    // Both join edges meet at the target, so select by keyboard rather than by a point on the curve.
    await dependency(page, DOMAIN, PLAN).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Delete");
    return page.getByRole("dialog", { name: "Apply this change?" });
  };
  let dialog = await remove();
  await expect(dialog).toContainText("fewer than two sources");
  // Cancel is the initial focus and leaves the loop exactly as it was.
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(dependency(page, DOMAIN, PLAN)).toHaveCount(1);
  await expectUntouched(page);
  // Confirm applies the removal and drops the join badge as ONE undo entry.
  dialog = await remove();
  await dialog.getByRole("button", { name: "Apply change" }).click();
  await expect(dependency(page, DOMAIN, PLAN)).toHaveCount(0);
  await expect(stepNode(page, PLAN).getByText("waits for all", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(dependency(page, DOMAIN, PLAN)).toHaveCount(1);
  await expect(stepNode(page, PLAN).getByText("waits for all", { exact: true })).toBeVisible();
  // One Undo restored everything: nothing is left to undo and the draft equals the saved one.
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
});

test("a group spanning lanes is framed per lane around its members only", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin, 1);
  const frames = page.locator(".graph-region-repeat");
  expect(await frames.count()).toBeGreaterThanOrEqual(3);
  // Only the first frame carries the label.
  await expect(page.locator(".graph-region-repeat .graph-region-label")).toHaveCount(1);
  // The Final verification step is not in the group, so no frame may enclose it.
  const outsider = await stepNode(page, "Final verification").boundingBox();
  if (!outsider) throw new Error("Final verification has no layout");
  const boxes = await frames.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().toJSON()),
  );
  const encloses = boxes.some(
    (box) =>
      box.x <= outsider.x &&
      box.y <= outsider.y &&
      box.x + box.width >= outsider.x + outsider.width &&
      box.y + box.height >= outsider.y + outsider.height,
  );
  expect(encloses).toBe(false);
});

test("the view is idle once opened: no node or edge is rebuilt without a change", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin, 1);
  await expect(page.locator(".graph-region").first()).toBeVisible();
  await page.waitForTimeout(500);
  const mutations = await page.locator(".react-flow__viewport").evaluate(
    (viewport) =>
      new Promise<number>((resolve) => {
        let count = 0;
        const observer = new MutationObserver((records) => {
          count += records.length;
        });
        observer.observe(viewport, { subtree: true, childList: true, attributes: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(count);
        }, 1000);
      }),
  );
  expect(mutations).toBe(0);
});

test("a step carrying several badges keeps them all inside its box", async ({ page, harness }) => {
  await openStarterInGraph(page, harness.origin, 1);
  // Verify and adjudicate: stage, repeat group, join and decision badges.
  const node = stepNode(page, ADJUDICATE);
  await expect(node.locator("span[title]")).toHaveCount(3);
  const clipped = await node.evaluate((wrapper) => {
    const box = wrapper.getBoundingClientRect();
    const inner = wrapper.firstElementChild;
    const badges = [...wrapper.querySelectorAll("span")].map((item) =>
      item.getBoundingClientRect(),
    );
    return {
      overflow: inner ? inner.scrollHeight - inner.clientHeight : -1,
      outside: badges.filter((item) => item.bottom > box.bottom + 0.5).length,
    };
  });
  expect(clipped).toEqual({ overflow: 0, outside: 0 });
});
