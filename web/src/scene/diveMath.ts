/**
 * Evidence dive helpers. Pure: no React, no store writes, no allocation in the per-frame paths
 * (callers pass the output vectors).
 */
import { Quaternion, Vector3 } from "three";
import type { AspectKey } from "@contract/types.ts";
import type { Mark } from "../store/useVitra.ts";
import { STATION_INDEX } from "../data/stations.ts";

export interface DiveTarget { itemId: string; aspect: AspectKey; }

export const diveKey = (t: DiveTarget) => `${t.itemId}:${t.aspect}`;

/** Glide length in seconds. Under one second by design. */
export const GLIDE_SECONDS = 0.85;

export const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

/**
 * The order Tab and the arrow keys walk through: visible marks along the journey
 * (station order), then by week, then from negative to positive.
 */
export function diveOrder(marks: readonly Mark[]): Mark[] {
  return marks
    .filter((m) => m.visible)
    .sort((a, b) =>
      STATION_INDEX[a.station] - STATION_INDEX[b.station]
      || (a.item.iso_week < b.item.iso_week ? -1 : a.item.iso_week > b.item.iso_week ? 1 : 0)
      || a.aspect.polarity - b.aspect.polarity
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Next (dir 1) or previous (dir -1) mark in the walk, wrapping. Unknown current starts the walk. */
export function stepDive(order: readonly Mark[], currentKey: string | null, dir: 1 | -1): Mark | null {
  if (order.length === 0) return null;
  const i = currentKey ? order.findIndex((m) => m.key === currentKey) : -1;
  if (i < 0) return dir === 1 ? order[0] : order[order.length - 1];
  return order[(i + dir + order.length) % order.length];
}

const _right = new Vector3();
const _out = new Vector3();

/** Panel-local gap between the station's right edge and the floating card's anchor. */
export const CARD_GAP = 0.1;

/**
 * Camera pose for an evidence point on a station panel. The camera faces the panel from a
 * little above and aims right of it, so the station sits left of center and the floating card
 * has the right side to itself. It leans a little toward the point, so a step to another
 * point on the same station is a small move.
 */
export function divePose(
  mark: Vector3,
  panelQuaternion: Quaternion,
  panelCenter: Vector3,
  outPos: Vector3,
  outTarget: Vector3,
  distance = 6.2,
): void {
  _out.set(0, 0, 1).applyQuaternion(panelQuaternion);
  _right.set(1, 0, 0).applyQuaternion(panelQuaternion);
  outTarget.copy(panelCenter).lerp(mark, 0.15).addScaledVector(_right, 0.95);
  outTarget.y = panelCenter.y + 0.12 + (mark.y - panelCenter.y) * 0.15;
  outPos.copy(outTarget).addScaledVector(_out, distance);
  outPos.y += 0.7;
}

/** Where the floating card pins: the panel's right edge, level with the point. */
export function cardAnchor(mark: Vector3, panelQuaternion: Quaternion, panelCenter: Vector3, halfWidth: number, out: Vector3): Vector3 {
  _right.set(1, 0, 0).applyQuaternion(panelQuaternion);
  const localX = _right.dot(out.copy(mark).sub(panelCenter));
  return out.copy(mark).addScaledVector(_right, halfWidth + CARD_GAP - localX);
}

/**
 * Control point for the trail from an evidence point to its station anchor: lifted off the
 * panel toward the viewer so the trail arcs instead of lying flat on the glass.
 */
export function trailControl(from: Vector3, to: Vector3, panelQuaternion: Quaternion, out: Vector3): Vector3 {
  _out.set(0, 0, 1).applyQuaternion(panelQuaternion);
  const span = from.distanceTo(to);
  return out.copy(from).lerp(to, 0.5).addScaledVector(_out, 0.35 + span * 0.35).setY(Math.max(from.y, to.y) + 0.15);
}
