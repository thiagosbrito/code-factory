import { expect, type Page } from "@playwright/test";
import { test } from "./support/editor-run.js";
import { openStarterInGraph } from "./support/graph.js";

test.use({ viewport: { width: 1600, height: 1200 } });

/** Tabs from the view switch until a step node has focus, as a keyboard user would arrive there. */
const tabToStep = async (page: Page) => {
  await page.getByRole("button", { name: "Graph" }).focus();
  for (let press = 0; press < 80; press += 1) {
    await page.keyboard.press("Tab");
    const onStep = await page.evaluate(() =>
      document.activeElement?.classList.contains("react-flow__node-step"),
    );
    if (onStep) return;
  }
  throw new Error("No step node was reachable with Tab");
};

const focusRing = (page: Page) =>
  page.evaluate(() => {
    const focused = document.activeElement ?? document.body;
    const style = getComputedStyle(focused);
    // The colour the theme's --ring token resolves to, read the way the browser resolves it.
    const probe = document.createElement("span");
    probe.style.color = "var(--ring)";
    document.body.append(probe);
    const ring = getComputedStyle(probe).color;
    probe.remove();
    const surface = getComputedStyle(focused.firstElementChild ?? focused).backgroundColor;
    return {
      style: style.outlineStyle,
      width: style.outlineWidth,
      color: style.outlineColor,
      ring,
      surface,
    };
  });

test("a keyboard-focused step shows a focus ring in both themes", async ({ page, harness }) => {
  await openStarterInGraph(page, harness.origin);
  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark") await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await tabToStep(page);
    await expect(page.locator(".react-flow__node-step:focus-visible")).toHaveCount(1);
    const ring = await focusRing(page);
    expect([ring.style, ring.width], theme).toEqual(["solid", "2px"]);
    expect(ring.color, theme).toBe(ring.ring);
    expect(ring.color, theme).not.toBe("rgba(0, 0, 0, 0)");
    expect(ring.color, theme).not.toBe(ring.surface);
  }
});

test("arrow keys move a selected step through the loop, so Undo and Save see it", async ({
  page,
  harness,
}) => {
  await openStarterInGraph(page, harness.origin);
  await tabToStep(page);
  const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  if (!label) throw new Error("The focused step has no label");
  const step = page.getByRole("group", { name: label, exact: true });
  await page.keyboard.press("Space");
  await expect(step).toHaveClass(/selected/);
  const before = await step.boundingBox();
  if (!before) throw new Error("Step has no layout");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await page.keyboard.press("Shift+ArrowDown");
  // The loop recorded the move: Undo and Save light up, which a flow-only move never did.
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
  await expect.poll(async () => (await step.boundingBox())?.y ?? 0).toBeGreaterThan(before.y + 1);
  await expect(step).toBeFocused();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(async () => Math.round((await step.boundingBox())?.y ?? 0))
    .toBe(Math.round(before.y));
  await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
});
