import { describe, expect, it } from "vitest";
import {
  canvasHeight,
  clampView,
  clampZoom,
  fitView,
  revealRect,
  zoomAt,
} from "../src/ui/features/runs/canvas-viewport.js";

const content = { width: 2000, height: 600 };
const viewport = { width: 1000, height: 400 };

describe("run canvas viewport", () => {
  it("fits the whole diagram, centered, and never above 100%", () => {
    const fit = fitView(content, viewport);
    expect(fit.zoom).toBeCloseTo(0.499, 2);
    expect(fit.x).toBeCloseTo((1000 - 2000 * fit.zoom) / 2, 1);
    expect(fit.y).toBeCloseTo((400 - 600 * fit.zoom) / 2, 1);
    expect(fitView({ width: 300, height: 200 }, viewport).zoom).toBe(1);
  });

  it("keeps room for floating controls at the top when fitting", () => {
    const fit = fitView({ width: 300, height: 200 }, viewport, 56);
    expect(fit.y).toBeGreaterThanOrEqual(56);
  });

  it("follows no size until the canvas has been measured", () => {
    expect(fitView(content, { width: 0, height: 0 })).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it("zooms around a point so the diagram under it stays put", () => {
    const view = { zoom: 0.5, x: 100, y: 50 };
    const anchor = { x: 400, y: 200 };
    const next = zoomAt(view, 1, anchor);
    // The diagram point under the anchor before and after the zoom.
    const before = { x: (anchor.x - view.x) / view.zoom, y: (anchor.y - view.y) / view.zoom };
    const after = { x: (anchor.x - next.x) / next.zoom, y: (anchor.y - next.y) / next.zoom };
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it("limits the zoom between 25% and 150%", () => {
    expect(clampZoom(0.01)).toBe(0.25);
    expect(clampZoom(9)).toBe(1.5);
    expect(zoomAt({ zoom: 1.4, x: 0, y: 0 }, 5, { x: 0, y: 0 }).zoom).toBe(1.5);
  });

  it("lets the diagram be panned anywhere but never out of reach", () => {
    const view = { zoom: 1, x: 0, y: 0 };
    const farRight = clampView({ ...view, x: 99999, y: 0 }, content, viewport);
    expect(farRight.x).toBeLessThan(viewport.width);
    expect(farRight.x).toBeGreaterThan(0);
    const farLeft = clampView({ ...view, x: -99999, y: -99999 }, content, viewport);
    expect(farLeft.x + content.width).toBeGreaterThan(0);
    expect(farLeft.y + content.height).toBeGreaterThan(0);
    expect(clampView({ ...view, x: -50, y: 20 }, content, viewport)).toEqual({
      zoom: 1,
      x: -50,
      y: 20,
    });
  });

  it("pans just enough to reveal a step that took focus", () => {
    const view = { zoom: 1, x: 0, y: 0 };
    const visible = revealRect(view, { x: 100, y: 100, width: 200, height: 100 }, viewport);
    expect(visible).toEqual(view);
    const right = revealRect(view, { x: 1200, y: 100, width: 200, height: 100 }, viewport, 24);
    expect(right.x).toBe(1000 - 24 - 1400);
    const below = revealRect(view, { x: 100, y: 500, width: 200, height: 100 }, viewport, 24);
    expect(below.y).toBe(400 - 24 - 600);
  });

  it("makes the canvas as tall as the diagram at fit width, within bounds", () => {
    expect(canvasHeight({ width: 1000, height: 500 }, 1000, 0)).toBe(499);
    expect(canvasHeight({ width: 1000, height: 100 }, 1000, 0)).toBe(340);
    expect(canvasHeight({ width: 1000, height: 5000 }, 1000, 0)).toBe(640);
    expect(canvasHeight(content, 0, 0)).toBe(600);
  });
});
