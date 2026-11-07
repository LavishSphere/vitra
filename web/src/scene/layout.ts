/**
 * Where things sit in the observatory.
 *
 * The five stations stand on a winding path that starts under the lungs and travels toward
 * the viewer: biology at the back, everyday reality at the front. Each station is a glass
 * plinth on the path with an upright panel above it.
 * Inside each panel: left to right = ISO week, height = polarity (-2..+2).
 */
import { CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from "three";
import { STATIONS, STATION_INDEX, type StationId } from "../data/stations.ts";

export type Vec3 = [number, number, number];
export interface CameraPose { position: Vec3; target: Vec3 }

export const PANEL = { width: 2.05, height: 1.7, polarityStep: 0.3, padX: 0.14 };

/** The floor the path is drawn on, just below the base of the lungs. */
export const FLOOR_Y = -3.55;
/** Glass plinth under each panel. The panel floats `gap` above its top face. */
export const PLINTH = { radius: 1.08, height: 0.12, gap: 0.2 };

/** Station footprints on the floor (x, z), in treatment order, back to front. */
const FOOTPRINTS: [number, number][] = [
  [1.25, 3.0],
  [-1.8, 4.85],
  [3.95, 6.7],
  [-4.05, 8.55],
  [0.95, 10.4],
];

/** Overview: high enough that the path reads as a path, framed on the lungs and all five stations. */
export const OVERVIEW = {
  position: new Vector3(0, 8.4, 27.2),
  target: new Vector3(0, -1.75, 4.6),
};

export interface StationFrame {
  id: StationId;
  /** Panel center. */
  position: Vector3;
  /** Plinth center on the floor, where the path passes through. */
  base: Vector3;
  quaternion: Quaternion;
  /** Panel-local to world. Panel-local x = week, y = polarity, +z toward the viewer. */
  matrix: Matrix4;
  /** Panel normal, toward the overview camera. */
  outward: Vector3;
}

const PANEL_LIFT = PLINTH.height + PLINTH.gap + PANEL.height / 2;
const UP = new Vector3(0, 1, 0);

export const STATION_FRAMES: StationFrame[] = STATIONS.map((s, i) => {
  const [x, z] = FOOTPRINTS[i];
  const base = new Vector3(x, FLOOR_Y, z);
  const position = new Vector3(x, FLOOR_Y + PANEL_LIFT, z);
  // Each panel turns to face the overview camera, so all five read from the front.
  const yaw = Math.atan2(OVERVIEW.position.x - x, OVERVIEW.position.z - z);
  const quaternion = new Quaternion().setFromAxisAngle(UP, yaw);
  const matrix = new Matrix4().compose(position, quaternion, new Vector3(1, 1, 1));
  const outward = new Vector3(0, 0, 1).applyQuaternion(quaternion);
  return { id: s.id, position, base, quaternion, matrix, outward };
});

export const frameOf = (id: StationId) => STATION_FRAMES[STATION_INDEX[id]];

/**
 * The journey path on the floor: from under the lungs, through each plinth in order, and on
 * toward the viewer. Centripetal Catmull-Rom so it never loops at the turns.
 */
export const JOURNEY_POINTS: Vec3[] = [
  [0, FLOOR_Y, 0.2],
  ...STATION_FRAMES.map((f): Vec3 => [f.base.x, FLOOR_Y, f.base.z]),
  [-0.6, FLOOR_Y, 13.2],
];
export const JOURNEY_CURVE = new CatmullRomCurve3(
  JOURNEY_POINTS.map((p) => new Vector3(...p)),
  false,
  "centripetal",
);

/** Recommended camera pose per station: square on to the panel, a little above it. */
const STATION_VIEW = { distance: 5.9, lift: 0.95, targetLift: 0.12 };
export const STATION_POSES: Record<StationId, CameraPose> = Object.fromEntries(
  STATION_FRAMES.map((f) => {
    const target: Vec3 = [f.position.x, f.position.y + STATION_VIEW.targetLift, f.position.z];
    const position: Vec3 = [
      f.position.x + f.outward.x * STATION_VIEW.distance,
      f.position.y + STATION_VIEW.lift,
      f.position.z + f.outward.z * STATION_VIEW.distance,
    ];
    return [f.id, { position, target }];
  }),
) as Record<StationId, CameraPose>;

export const OVERVIEW_POSE: CameraPose = {
  position: OVERVIEW.position.toArray() as Vec3,
  target: OVERVIEW.target.toArray() as Vec3,
};

/** Panel-local x for a week index in [0, n-1]. */
export function weekX(index: number, n: number): number {
  const w = PANEL.width - PANEL.padX * 2;
  return n <= 1 ? 0 : -w / 2 + (index / (n - 1)) * w;
}

/** Writes a station's recommended camera pose into the given vectors. */
export function stationCamera(id: StationId, outPos: Vector3, outTarget: Vector3) {
  const p = STATION_POSES[id];
  outPos.set(...p.position);
  outTarget.set(...p.target);
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
