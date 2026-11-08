/**
 * Where things sit in the observatory.
 *
 * The lungs stand at the origin and stay the center of every view. The five stations orbit
 * them on a tilted ring, in treatment order: the first two up the left side, the third just
 * below and in front, the last two up the right side. The back of the ring is higher than the
 * front, so no station hides behind the lungs and none covers them. Each station is a glass
 * plinth on the ring with an upright panel above it.
 * Inside each panel: left to right = ISO week, height = polarity (-2..+2).
 */
import { CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from "three";
import { STATIONS, STATION_INDEX, type StationId } from "../data/stations.ts";

export type Vec3 = [number, number, number];
export interface CameraPose { position: Vec3; target: Vec3 }

export const PANEL = { width: 2.05, height: 1.7, polarityStep: 0.3, padX: 0.14 };

/** The stage floor glow, just below the base of the lungs. */
export const FLOOR_Y = -3.55;
/** Glass plinth under each panel. The panel floats `gap` above its top face. */
export const PLINTH = { radius: 1.08, height: 0.12, gap: 0.2 };

const PANEL_LIFT = PLINTH.height + PLINTH.gap + PANEL.height / 2;

/**
 * The orbit: a circle of `radius` around the lungs' vertical axis, tilted so the back rises
 * and the front dips by `tilt` radians. `y` is the height of the ring (plinth bases sit on it)
 * at the sides.
 */
export const ORBIT = { radius: 4.0, y: -PANEL_LIFT, tilt: 0.4 };

/** Station angles around the lungs (radians from the front, positive to the viewer's right). */
const ANGLES = [-1.9, -1.0, 0, 1.0, 1.9];

/** Point on the orbit at angle `theta`. Writes into `out`. */
export function orbitPoint(theta: number, out: Vector3 = new Vector3()): Vector3 {
  const { radius: r, y, tilt } = ORBIT;
  return out.set(r * Math.sin(theta), y - Math.cos(theta) * r * Math.sin(tilt), r * Math.cos(theta));
}

/** Overview: lungs centered and large, all five stations around them, above the timeline. */
export const OVERVIEW = {
  position: new Vector3(0, 6.0, 15.75),
  target: new Vector3(0, -1.6, 0),
};

export interface StationFrame {
  id: StationId;
  /** Panel center. */
  position: Vector3;
  /** Plinth center, on the orbit, where the path passes through. */
  base: Vector3;
  quaternion: Quaternion;
  /** Panel-local to world. Panel-local x = week, y = polarity, +z toward the viewer. */
  matrix: Matrix4;
  /** Panel normal, toward the overview camera. */
  outward: Vector3;
}

const UP = new Vector3(0, 1, 0);

export const STATION_FRAMES: StationFrame[] = STATIONS.map((s, i) => {
  const base = orbitPoint(ANGLES[i]);
  const position = base.clone().setY(base.y + PANEL_LIFT);
  // Each panel turns to face the overview camera, so all five read from the front.
  const yaw = Math.atan2(OVERVIEW.position.x - base.x, OVERVIEW.position.z - base.z);
  const quaternion = new Quaternion().setFromAxisAngle(UP, yaw);
  const matrix = new Matrix4().compose(position, quaternion, new Vector3(1, 1, 1));
  const outward = new Vector3(0, 0, 1).applyQuaternion(quaternion);
  return { id: s.id, position, base, quaternion, matrix, outward };
});

export const frameOf = (id: StationId) => STATION_FRAMES[STATION_INDEX[id]];

/** The journey path: the whole orbit, a closed ring through every plinth around the lungs. */
const RING_SAMPLES = 72;
export const JOURNEY_POINTS: Vec3[] = Array.from({ length: RING_SAMPLES }, (_, k) =>
  orbitPoint(ANGLES[0] + (k / RING_SAMPLES) * Math.PI * 2).toArray() as Vec3);
export const JOURNEY_CURVE = new CatmullRomCurve3(
  JOURNEY_POINTS.map((p) => new Vector3(...p)),
  true,
  "centripetal",
);

/**
 * Camera pose per station: in front of the panel and a little above it, swung out away from
 * the lungs by `swing` so the lungs sit beside or behind the station in the frame. The aim
 * point leans toward the lungs by `lean`. Flights between poses circle around the lungs (see
 * CameraRig).
 */
const STATION_VIEW = { distance: 5.9, lift: 0.95, targetLift: 0.12, swing: 0.36, lean: 0.85 };
export const STATION_POSES: Record<StationId, CameraPose> = Object.fromEntries(
  STATION_FRAMES.map((f) => {
    const side = f.position.x < -0.1 ? -1 : 1;
    const dir = f.outward.clone().applyAxisAngle(UP, side * STATION_VIEW.swing);
    const inward = new Vector3(-f.position.x, 0, -f.position.z).normalize();
    const lean = Math.abs(f.position.x) > 0.5 ? STATION_VIEW.lean : 0;
    const target: Vec3 = [
      f.position.x + inward.x * lean,
      f.position.y + STATION_VIEW.targetLift,
      f.position.z + inward.z * lean,
    ];
    const position: Vec3 = [
      f.position.x + dir.x * STATION_VIEW.distance,
      f.position.y + STATION_VIEW.lift,
      f.position.z + dir.z * STATION_VIEW.distance,
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
