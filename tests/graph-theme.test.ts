import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/ui/styles.css", "utf8");

/** The value a custom property has inside the first block that declares it after `selector`. */
const token = (selector: string, name: string): string => {
  const block = css.slice(css.indexOf(selector));
  const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`${name} not found after ${selector}`);
  return match[1];
};

const luminance = (hex: string): number => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (left: string, right: string): number => {
  const [high = 0, low = 0] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
};

describe("Graph view theme tokens", () => {
  it("draws connections at 3:1 or better against the canvas in light mode", () => {
    expect(
      contrast(token(":root", "--graph-edge"), token(":root", "--graph-bg")),
    ).toBeGreaterThanOrEqual(3);
  });

  it("draws connections at 3:1 or better against the canvas in dark mode", () => {
    expect(
      contrast(token(".dark", "--graph-edge"), token(".dark", "--graph-bg")),
    ).toBeGreaterThanOrEqual(3);
  });

  it.each(["--graph-join", "--graph-continue", "--graph-region-parallel", "--graph-region-repeat"])(
    "draws %s at 3:1 or better against the canvas in both themes",
    (name) => {
      for (const selector of [":root", ".dark"])
        expect(
          contrast(token(selector, name), token(selector, "--graph-bg")),
        ).toBeGreaterThanOrEqual(3);
    },
  );

  it("keeps the continuation dashed (not a dependency look) and regions free of pointer events by design", () => {
    expect(css).toMatch(
      /\.graph-continue-path\s*\{[^}]*stroke-dasharray:\s*6 4[^}]*pointer-events:\s*none/,
    );
    expect(css).toMatch(/\.graph-region-parallel\s*\{[^}]*border-style:\s*dashed/);
    expect(css).toMatch(/\.graph-region-repeat\s*\{[^}]*border-style:\s*solid/);
  });

  it("shows a keyboard focus ring on step nodes, which the library otherwise hides", () => {
    expect(css).toMatch(
      /\.react-flow__node-step:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ring\)/,
    );
  });

  it("stops any edge animation under reduced motion", () => {
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\.react-flow__edge\.animated path[^}]*animation:\s*none/,
    );
  });
});
