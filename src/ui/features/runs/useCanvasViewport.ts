import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import {
  canvasHeight,
  clampView,
  clampZoom,
  fitView,
  revealRect,
  zoomAt,
  type Rect,
  type Size,
  type View,
} from "./canvas-viewport";

/** How far the pointer must travel before a press becomes a drag, so a click still selects. */
const DRAG_THRESHOLD = 4;
/** Wheel zoom speed: a standard wheel notch (about 100) changes the zoom by roughly 20%. */
const WHEEL_SPEED = 0.002;
/** A pinch gesture arrives as ctrl+wheel with small deltas. */
const PINCH_SPEED = 0.01;

/**
 * The run canvas's viewport: a fixed-size window over the diagram. Dragging with the mouse, a pen
 * or a finger pans in every direction at any zoom, the wheel zooms around the cursor, and the
 * buttons zoom around the center. Until the user pans or zooms, the view follows the canvas size
 * and shows the whole diagram ("fit"). A drag swallows the click that ends it, so panning over a
 * step does not also select it.
 */
export const useCanvasViewport = ({
  content,
  insetTop,
}: {
  content: Size;
  /** Space kept clear at the top for floating controls. */
  insetTop: number;
}) => {
  // A callback ref held in state, so effects re-run when the element mounts or changes.
  const [canvas, setCanvas] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  const [manual, setManual] = useState<View | null>(null);
  const height = canvasHeight(content, width, insetTop);
  const viewport: Size = { width, height };
  const fit = fitView(content, viewport, insetTop);
  const view = manual ?? fit;

  // The latest values for event handlers that must not be re-attached on every render.
  const latest = useRef({ content, viewport, fit, view });
  useEffect(() => {
    latest.current = { content, viewport, fit, view };
  });

  useEffect(() => {
    const element = canvas;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [canvas]);

  const update = useCallback((change: (current: View) => View) => {
    setManual((previous) => {
      const now = latest.current;
      return clampView(change(previous ?? now.fit), now.content, now.viewport);
    });
  }, []);

  // React attaches wheel listeners as passive, which cannot stop the page from scrolling.
  useEffect(() => {
    const element = canvas;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const speed = event.ctrlKey ? PINCH_SPEED : WHEEL_SPEED;
      update((current) => zoomAt(current, current.zoom * Math.exp(-event.deltaY * speed), anchor));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [canvas, update]);

  const swallowClick = useRef(false);

  // The drag is followed on the window, so it keeps working when the pointer leaves the canvas
  // before it has travelled far, and a click on a step is still delivered to that step.
  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    swallowClick.current = false;
    const origin = latest.current.view;
    const first = { x: event.clientX, y: event.clientY };
    const pointerId = event.pointerId;
    let panned = false;
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      const dx = next.clientX - first.x;
      const dy = next.clientY - first.y;
      if (!panned && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      panned = true;
      update(() => ({ ...origin, x: origin.x + dx, y: origin.y + dy }));
    };
    const end = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      swallowClick.current = panned && next.type === "pointerup";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const handlers = {
    onPointerDown: startDrag,
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  return {
    canvasRef: setCanvas,
    view,
    height,
    /** True while the view follows the canvas instead of the user's pan and zoom. */
    fitted: manual === null,
    handlers,
    /** Adds to the zoom (buttons), around the middle of the canvas. */
    zoomBy: (delta: number) =>
      update((current) =>
        zoomAt(current, clampZoom(current.zoom + delta), {
          x: viewport.width / 2,
          y: viewport.height / 2,
        }),
      ),
    fitToCanvas: () => setManual(null),
    /** Pans just enough to show a diagram rectangle, e.g. the step that took keyboard focus. */
    reveal: (rect: Rect) => update((current) => revealRect(current, rect, latest.current.viewport)),
  };
};
