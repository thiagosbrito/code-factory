import { useRef, type PointerEvent, type RefObject } from "react";

/** How far the pointer must travel before a press becomes a drag, so a click still selects. */
const DRAG_THRESHOLD = 4;

/**
 * Drag-to-pan for a scrollable canvas: pressing anywhere on it, nodes included, and dragging with
 * the mouse or a pen scrolls it. Touch keeps its native scrolling. A drag swallows the click that
 * ends it, so panning over a node does not also select the node. Zoom is not handled here.
 */
export const useCanvasPan = (canvas: RefObject<HTMLElement | null>) => {
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
    panned: boolean;
  } | null>(null);
  const swallowClick = useRef(false);
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      const element = canvas.current;
      if (!element || event.button !== 0 || event.pointerType === "touch") return;
      // Floating controls and form fields keep their own behavior.
      if (event.target instanceof Element && event.target.closest("input, textarea, select"))
        return;
      swallowClick.current = false;
      drag.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: element.scrollLeft,
        top: element.scrollTop,
        panned: false,
      };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const element = canvas.current;
      const start = drag.current;
      if (!element || !start || start.pointerId !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!start.panned) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        start.panned = true;
        element.setPointerCapture(event.pointerId);
      }
      element.scrollTo({ left: start.left - dx, top: start.top - dy });
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const start = drag.current;
      if (!start || start.pointerId !== event.pointerId) return;
      drag.current = null;
      if (start.panned) {
        swallowClick.current = true;
        canvas.current?.releasePointerCapture(event.pointerId);
      }
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
};
