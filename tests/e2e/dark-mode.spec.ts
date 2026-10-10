import { expect, type Locator, type Page } from "@playwright/test";
import { finishSetup, test } from "./support/editor-run.js";

const toDark = (page: Page) => page.getByRole("button", { name: "Switch to dark mode" });
const toLight = (page: Page) => page.getByRole("button", { name: "Switch to light mode" });
const isDark = (page: Page) =>
  page.locator("html").evaluate((root) => root.classList.contains("dark"));

/** WCAG contrast of an element's text against the first opaque background above it. */
const contrastOf = (locator: Locator) =>
  locator.evaluate((element) => {
    const parse = (value: string) => {
      // Tailwind 4 emits oklch/color-mix; the canvas converts any CSS color to sRGB.
      const canvas = document.createElement("canvas").getContext("2d");
      if (!canvas) throw new Error("No canvas");
      canvas.fillStyle = "#000";
      canvas.fillStyle = value;
      canvas.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 255] = canvas.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (value: number) => {
        const s = value / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    let background = { r: 255, g: 255, b: 255, a: 1 };
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color.a > 0.95) {
        background = color;
        break;
      }
    }
    const text = parse(getComputedStyle(element).color);
    const [light, dark] = [luminance(text), luminance(background)].sort((a, b) => b - a);
    return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
  });

test("the theme follows the system, can be toggled, and the choice survives a reload", async ({
  page,
  harness,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await finishSetup(page, harness.origin);
  expect(await isDark(page)).toBe(true);
  await expect(toLight(page)).toBeVisible();

  await toLight(page).click();
  expect(await isDark(page)).toBe(false);
  await page.reload();
  // A stored choice beats the dark system preference, and is applied by the time the app renders.
  expect(await isDark(page)).toBe(false);
  await expect(toDark(page)).toBeVisible();

  await toDark(page).click();
  await page.reload();
  expect(await isDark(page)).toBe(true);
  await expect(toLight(page)).toBeVisible();
});

test("the theme is applied before the app mounts, so a reload never flashes the other theme", async ({
  page,
  harness,
}) => {
  await finishSetup(page, harness.origin);
  await toDark(page).click();
  await page.addInitScript(() => {
    // Record the root class at the first moment the body exists, before React renders.
    document.addEventListener("DOMContentLoaded", () => {
      (window as unknown as { earlyDark: boolean }).earlyDark =
        document.documentElement.classList.contains("dark") && !document.querySelector("#root > *");
    });
  });
  await page.reload();
  expect(await page.evaluate(() => (window as unknown as { earlyDark: boolean }).earlyDark)).toBe(
    true,
  );
});

test("text stays readable on the main screens in both themes", async ({ page, harness }) => {
  await finishSetup(page, harness.origin);
  await page.getByRole("button", { name: "Loops" }).click();
  await page.getByRole("button", { name: "Create empty loop" }).first().click();

  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark") await toDark(page).click();
    expect(await isDark(page)).toBe(theme === "dark");
    const checks = [
      page.getByRole("textbox", { name: "Loop title" }),
      page.getByRole("heading", { name: "Execution stages" }),
      page.getByRole("button", { name: "Save draft" }),
      page.getByRole("heading", { name: /Evidence/ }).first(),
    ];
    for (const locator of checks) {
      expect(
        await contrastOf(locator),
        `${theme}: ${await locator.innerText().catch(() => "")}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
  await page.getByRole("button", { name: "Runs" }).click();
  await expect(page.getByRole("heading", { name: "Runs", exact: true })).toBeVisible();
  expect(
    await contrastOf(page.getByRole("heading", { name: "Runs", exact: true })),
  ).toBeGreaterThanOrEqual(4.5);
});
