import { useEffect, useRef, useState } from "react";

/** The inspector's width and the pointer-drag that resizes it from its right edge. */
export const useInspectorWidth = () => {
  const [width, setWidth] = useState(520);
  const drag = useRef(false);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (drag.current)
        setWidth(
          Math.max(
            360,
            Math.min(
              window.innerWidth * 0.75,
              event.clientX - (window.innerWidth >= 768 ? 232 : 0),
            ),
          ),
        );
    };
    const stop = () => {
      drag.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, []);
  const startDrag = () => {
    drag.current = true;
  };
  return { width, setWidth, startDrag };
};
