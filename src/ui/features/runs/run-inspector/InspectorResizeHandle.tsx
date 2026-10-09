import type { Dispatch, SetStateAction } from "react";

export const InspectorResizeHandle = ({
  width,
  onWidthChange,
  onDragStart,
}: {
  width: number;
  onWidthChange: Dispatch<SetStateAction<number>>;
  onDragStart: () => void;
}) => (
  <input
    type="range"
    aria-label="Resize inspector"
    aria-orientation="vertical"
    min={360}
    max={Math.round(window.innerWidth * 0.75)}
    value={width}
    onChange={(event) => onWidthChange(Number(event.target.value))}
    className="absolute bottom-0 right-0 top-0 z-10 w-2 cursor-ew-resize hover:bg-primary/20"
    onPointerDown={(event) => {
      onDragStart();
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onKeyDown={(event) => {
      if (event.key === "ArrowRight")
        onWidthChange((value) => Math.min(value + 24, window.innerWidth * 0.75));
      if (event.key === "ArrowLeft") onWidthChange((value) => Math.max(360, value - 24));
    }}
  />
);
