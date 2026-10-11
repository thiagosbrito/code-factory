/** Pure viewport math for the run canvas: a translate and a zoom over a fixed-size diagram. */
export type View = { zoom: number; x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 1.5;
/** How much of the diagram must stay on screen, so it can never be panned out of reach. */
const KEEP_VISIBLE = 80;
const MIN_CANVAS_HEIGHT = 340;
const MAX_CANVAS_HEIGHT = 640;

export const clampZoom = (zoom: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 1000) / 1000));

const between = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, Math.min(low, high)), Math.max(low, high));

/** The canvas is as tall as the diagram at fit width, within sensible bounds. */
export const canvasHeight = (content: Size, width: number, insetTop: number): number => {
  const fitWidth = width ? Math.min(1, (width - 2) / content.width) : 1;
  return Math.round(
    Math.min(MAX_CANVAS_HEIGHT, Math.max(MIN_CANVAS_HEIGHT, content.height * fitWidth + insetTop)),
  );
};

/** The whole diagram centered and as large as fits, but never above 100%. */
export const fitView = (content: Size, viewport: Size, insetTop = 0): View => {
  if (!viewport.width || !viewport.height) return { zoom: 1, x: 0, y: 0 };
  const availableHeight = viewport.height - insetTop;
  const zoom = clampZoom(
    Math.min(1, (viewport.width - 2) / content.width, availableHeight / content.height),
  );
  return {
    zoom,
    x: (viewport.width - content.width * zoom) / 2,
    y: insetTop + (availableHeight - content.height * zoom) / 2,
  };
};

/** Changes the zoom while the diagram point under `anchor` (viewport pixels) stays put. */
export const zoomAt = (view: View, nextZoom: number, anchor: { x: number; y: number }): View => {
  const zoom = clampZoom(nextZoom);
  const ratio = zoom / view.zoom;
  return {
    zoom,
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
  };
};

/** Keeps a margin of the diagram on screen. */
export const clampView = (view: View, content: Size, viewport: Size): View => {
  const width = content.width * view.zoom;
  const height = content.height * view.zoom;
  const keepX = Math.min(KEEP_VISIBLE, width, viewport.width);
  const keepY = Math.min(KEEP_VISIBLE, height, viewport.height);
  return {
    zoom: view.zoom,
    x: between(view.x, keepX - width, viewport.width - keepX),
    y: between(view.y, keepY - height, viewport.height - keepY),
  };
};

/** The smallest pan that brings a diagram rectangle fully into view (with padding). */
export const revealRect = (view: View, rect: Rect, viewport: Size, padding = 24): View => {
  const left = view.x + rect.x * view.zoom;
  const top = view.y + rect.y * view.zoom;
  const right = left + rect.width * view.zoom;
  const bottom = top + rect.height * view.zoom;
  let { x, y } = view;
  if (left < padding) x += padding - left;
  else if (right > viewport.width - padding) x -= right - (viewport.width - padding);
  if (top < padding) y += padding - top;
  else if (bottom > viewport.height - padding) y -= bottom - (viewport.height - padding);
  return { ...view, x, y };
};
