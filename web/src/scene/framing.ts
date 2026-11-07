/**
 * Hero framing for the lungs: the overview camera and the start of the arrival move.
 * Station waypoints come from layout.ts (stationCamera); this file only frames the lungs.
 */
import { Vector3 } from "three";

/** Floor height, just under the diaphragm. */
export const FLOOR_Y = -3.55;

/**
 * Overview: the lungs and trachea (about y -2.7 to 2.8) fill about 60% of the frame
 * height at fov 34, centered, seen from a little above.
 */
export const HERO = {
  position: new Vector3(0, 1.85, 12.9),
  target: new Vector3(0, -0.25, 0),
};

/** The arrival move starts here: higher, farther and turned a little, then pushes in. */
export const ARRIVAL_START = {
  position: new Vector3(-5.8, 6.8, 26.5),
  target: new Vector3(0, 0.6, 0),
};

/**
 * Overview distance multiplier. Wide screens use the hero distance; narrow ones pull back so
 * the lungs still fit across.
 */
export function overviewFit(aspect: number): number {
  return Math.min(1.5, Math.max(1, 1.2 / Math.max(0.3, aspect)));
}
