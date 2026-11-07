/**
 * Where things sit in the observatory. Stations stand on an arc in front of the lungs.
 * Inside each station panel: left to right = ISO week, height = polarity (-2..+2).
 */
import { Matrix4, Quaternion, Vector3 } from "three";
import { STATIONS, STATION_INDEX, type StationId } from "../data/stations.ts";

export const PANEL = { width: 2.05, height: 1.7, polarityStep: 0.3, padX: 0.14 };
/** Stations sit on a shallow arc in front of the lungs, evenly spaced across the view. */
export const ARC = { spacing: 2.42, z0: 3.6, curve: 0.075, y: -2.55, facing: 0.9 };

export const OVERVIEW = {
  position: new Vector3(0, 5.2, 20.5),
  target: new Vector3(0, -0.85, 0),
};

export interface StationFrame {
  id: StationId;
  position: Vector3; // panel center
  quaternion: Quaternion;
  matrix: Matrix4;
  outward: Vector3; // panel normal (toward the audience)
}

export const STATION_FRAMES: StationFrame[] = STATIONS.map((s, i) => {
  const x = (i - (STATIONS.length - 1) / 2) * ARC.spacing;
  const z = ARC.z0 - ARC.curve * x * x;
  const position = new Vector3(x, ARC.y, z);
  // Turn each panel toward the overview camera so all five read from the front.
  const yaw = Math.atan2(x - OVERVIEW.position.x, OVERVIEW.position.z - z) * ARC.facing;
  const quaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const matrix = new Matrix4().compose(position, quaternion, new Vector3(1, 1, 1));
  const outward = new Vector3(0, 0, 1).applyQuaternion(quaternion);
  return { id: s.id, position, quaternion, matrix, outward };
});

export const frameOf = (id: StationId) => STATION_FRAMES[STATION_INDEX[id]];

/** Panel-local x for a week index in [0, n-1]. */
export function weekX(index: number, n: number): number {
  const w = PANEL.width - PANEL.padX * 2;
  return n <= 1 ? 0 : -w / 2 + (index / (n - 1)) * w;
}

/** Camera waypoint that faces a station from outside the ring. */
const _normal = new Vector3();
export function stationCamera(id: StationId, outPos: Vector3, outTarget: Vector3) {
  const f = frameOf(id);
  _normal.set(0, 0, 1).applyQuaternion(f.quaternion);
  outTarget.copy(f.position).setY(f.position.y + 0.35);
  outPos.copy(f.position).addScaledVector(_normal, 6.6).setY(f.position.y + 1.25);
}

/** Anchor for a station's label: just above the panel's top-left corner. */
export function stationLabelAnchor(id: StationId): Vector3 {
  const f = frameOf(id);
  return new Vector3(-PANEL.width / 2, PANEL.height / 2 + 0.12, 0).applyMatrix4(f.matrix);
}

export function stationAxisAnchor(id: StationId, polarity: number): Vector3 {
  const f = frameOf(id);
  return new Vector3(PANEL.width / 2 + 0.06, polarity * PANEL.polarityStep, 0).applyMatrix4(f.matrix);
}


export const TUMOR_VIEW = {
  position: new Vector3(-4.6, 2.3, 5.4),
  target: new Vector3(-1.2, 0.7, 0.2),
};

/** World position of an (item, aspect) mark, ignoring collision stacking. Writes into `out`. */
export function markWorldPosition(station: StationId, weekIndex: number, nWeeks: number, polarity: number, out: Vector3): Vector3 {
  out.set(weekX(weekIndex, nWeeks), polarity * PANEL.polarityStep, 0.1);
  return out.applyMatrix4(frameOf(station).matrix);
}
