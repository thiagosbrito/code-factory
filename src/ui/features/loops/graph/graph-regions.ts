import type { LoopDefinition } from "../../../../domain/loop.js";
import { NODE_HEIGHT, NODE_WIDTH, type Point } from "./graph-layout";

/**
 * Group regions are view-only geometry: the padded bounding box of a group's drawn members. They
 * are recomputed from where the steps are drawn and never stored in the loop.
 */
export type GroupRegion = {
  id: string;
  kind: "parallel" | "repeat";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const PAD_X = 8;
const PAD_TOP = 8;
/** Room under the members for the region's label. */
const PAD_BOTTOM = 26;

const iterations = (count: number): string => `${count} iteration${count === 1 ? "" : "s"}`;

export const groupRegions = (
  loop: LoopDefinition,
  positions: ReadonlyMap<string, Point>,
): GroupRegion[] =>
  loop.groups.flatMap((group) => {
    const points = group.stepIds.flatMap((id) => {
      const point = positions.get(id);
      return point ? [point] : [];
    });
    if (!points.length) return [];
    const left = Math.min(...points.map((point) => point.x));
    const right = Math.max(...points.map((point) => point.x));
    const top = Math.min(...points.map((point) => point.y));
    const bottom = Math.max(...points.map((point) => point.y));
    return [
      {
        id: group.id,
        kind: group.kind,
        label:
          group.kind === "repeat"
            ? `Repeat group: ${group.name} (max ${iterations(group.maxIterations)})`
            : `Parallel group: ${group.name}`,
        x: left - PAD_X,
        y: top - PAD_TOP,
        width: right - left + NODE_WIDTH + PAD_X * 2,
        height: bottom - top + NODE_HEIGHT + PAD_TOP + PAD_BOTTOM,
      },
    ];
  });
