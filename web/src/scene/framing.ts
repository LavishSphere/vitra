/**
 * Camera framing for the first look. The resting view is layout.ts's OVERVIEW (lungs large
 * and centered, the stations orbiting them); this file adds where the arrival push starts and
 * how far to pull back on narrow screens.
 */
import { Vector3 } from "three";

/** The arrival move starts here: higher, farther and turned a little, then pushes in. */
export const ARRIVAL_START = {
  position: new Vector3(-6.5, 12.5, 34),
  target: new Vector3(0, -0.4, 0),
};

/**
 * Overview distance multiplier. The overview fits the scene area at 1020 px wide or more
 * (1440x900 with the report open); narrower ones pull back so the ring still fits across.
 */
export function overviewFit(aspect: number): number {
  return Math.min(2.2, Math.max(1, 1.24 / Math.max(0.3, aspect)));
}
