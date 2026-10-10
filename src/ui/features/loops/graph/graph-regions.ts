import type { LoopDefinition } from "../../../../domain/loop.js";
import { laneAtX, NODE_HEIGHT, NODE_WIDTH, stageIndex, type Point } from "./graph-layout";

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

/**
 * One frame per lane that holds members, each around only that lane's members, so a frame never
 * spans a lane to enclose steps that are not in the group. The first (leftmost) frame carries the
 * label; the others have an empty one and share the group's kind.
 */
export const groupRegions = (
  loop: LoopDefinition,
  positions: ReadonlyMap<string, Point>,
): GroupRegion[] =>
  loop.groups.flatMap((group) => {
    const byLane = new Map<number, Point[]>();
    for (const id of group.stepIds) {
      const point = positions.get(id);
      if (!point) continue;
      const lane = stageIndex(laneAtX(point.x));
      byLane.set(lane, [...(byLane.get(lane) ?? []), point]);
    }
    const label =
      group.kind === "repeat"
        ? `Repeat group: ${group.name} (max ${iterations(group.maxIterations)})`
        : `Parallel group: ${group.name}`;
    return [...byLane.entries()]
      .sort(([left], [right]) => left - right)
      .map(([lane, points], index) => {
        const left = Math.min(...points.map((point) => point.x));
        const right = Math.max(...points.map((point) => point.x));
        const top = Math.min(...points.map((point) => point.y));
        const bottom = Math.max(...points.map((point) => point.y));
        return {
          id: index === 0 ? group.id : `${group.id}@${lane}`,
          kind: group.kind,
          label: index === 0 ? label : "",
          x: left - PAD_X,
          y: top - PAD_TOP,
          width: right - left + NODE_WIDTH + PAD_X * 2,
          height: bottom - top + NODE_HEIGHT + PAD_TOP + PAD_BOTTOM,
        };
      });
  });
