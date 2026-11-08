import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useVitra } from "../store/useVitra.ts";
import { OVERVIEW, TUMOR_VIEW, stationCamera } from "./layout.ts";
import { ARRIVAL_START, overviewFit } from "./framing.ts";
import { useArrival } from "./arrival.ts";

/** Push-in from far out to the overview, then station and overview flights. */
const ARRIVAL_SECONDS = 2.8;
const FLIGHT_SECONDS = 1.7;

const easeOutCubic = (u: number) => 1 - Math.pow(1 - u, 3);
const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

interface Flight {
  active: boolean;
  t: number;
  duration: number;
  /** The push-in: eased out, no lift, not cancelled by a drag. */
  arrival: boolean;
  fromPos: Vector3;
  fromTarget: Vector3;
  toPos: Vector3;
  toTarget: Vector3;
  // Cylindrical coordinates (around the lungs' vertical axis) of the endpoints.
  a0: number; a1: number; r0: number; r1: number;
}

/** Scales a pose's distance from its target by `k`, writing into the out vectors. */
function fitPose(pose: { position: Vector3; target: Vector3 }, k: number, outPos: Vector3, outTarget: Vector3) {
  outTarget.copy(pose.target);
  outPos.copy(pose.position).sub(pose.target).multiplyScalar(k).add(outTarget);
}

/**
 * Flies the camera between waypoints: the arrival push-in to the overview, a station
 * (`cameraFocus.stationId`, posed by layout.ts STATION_POSES), the tumor, and back to the
 * overview. Flights circle around the lungs instead of cutting through them, so the lungs
 * stay in shot. A drag cancels a flight; any input during the push-in skips to the overview.
 */
export function CameraRig({ animate, railPx }: { animate: boolean; railPx: number }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const size = useThree((s) => s.size);
  // Evidence dives own the camera; only station focus flies the rig.
  const cameraStation = useVitra((s) => (s.cameraFocus?.kind === "station" ? s.cameraFocus.stationId : null));
  const focusTumor = useVitra((s) => s.focusTumor);
  const arriving = useArrival((s) => s.arriving);

  const flight = useRef<Flight>({
    active: false, t: 0, duration: FLIGHT_SECONDS, arrival: false,
    fromPos: new Vector3(), fromTarget: new Vector3(), toPos: new Vector3(), toTarget: new Vector3(),
    a0: 0, a1: 0, r0: 0, r1: 0,
  });
  const started = useRef(false);
  const overviewPos = useRef(new Vector3());
  const overviewTarget = useRef(new Vector3());
  const goalPos = useRef(new Vector3());
  const goalTarget = useRef(new Vector3());

  // Poses for the current viewport (the part not covered by the rail).
  const aspect = Math.max(0.3, (size.width - (size.width > 900 ? railPx : 0)) / Math.max(1, size.height));
  fitPose(OVERVIEW, overviewFit(aspect), overviewPos.current, overviewTarget.current);

  const begin = (toPos: Vector3, toTarget: Vector3, duration: number, arrival: boolean) => {
    const f = flight.current;
    f.fromPos.copy(camera.position);
    f.fromTarget.copy(controls ? controls.target : OVERVIEW.target);
    f.toPos.copy(toPos);
    f.toTarget.copy(toTarget);
    f.a0 = Math.atan2(f.fromPos.x, f.fromPos.z);
    f.a1 = Math.atan2(toPos.x, toPos.z);
    // Shortest way round.
    if (f.a1 - f.a0 > Math.PI) f.a1 -= 2 * Math.PI;
    if (f.a0 - f.a1 > Math.PI) f.a1 += 2 * Math.PI;
    f.r0 = Math.hypot(f.fromPos.x, f.fromPos.z);
    f.r1 = Math.hypot(toPos.x, toPos.z);
    f.t = 0;
    f.duration = duration;
    f.arrival = arrival;
    f.active = true;
  };

  const snapTo = (pos: Vector3, target: Vector3) => {
    flight.current.active = false;
    camera.position.copy(pos);
    if (controls) { controls.target.copy(target); controls.update(); }
  };

  /** True while the push-in is running. */
  const inIntro = () => flight.current.active && flight.current.arrival;

  // Arrival: start back and up, then push in. Reduced motion starts at the overview.
  useEffect(() => {
    if (!controls || started.current) return;
    started.current = true;
    if (!animate || !useArrival.getState().arriving) {
      snapTo(overviewPos.current, overviewTarget.current);
      useArrival.getState().finish();
      return;
    }
    snapTo(ARRIVAL_START.position, ARRIVAL_START.target);
    begin(overviewPos.current, overviewTarget.current, ARRIVAL_SECONDS, true);
    // begin and snapTo only touch refs and the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, animate]);

  // Skip: any pointer, wheel or key during the push-in jumps to the overview.
  useEffect(() => {
    if (!arriving) {
      if (inIntro()) snapTo(overviewPos.current, overviewTarget.current);
      return;
    }
    const skip = () => useArrival.getState().skip();
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", skip, opts);
    window.addEventListener("wheel", skip, opts);
    window.addEventListener("keydown", skip, opts);
    return () => {
      window.removeEventListener("pointerdown", skip, opts);
      window.removeEventListener("wheel", skip, opts);
      window.removeEventListener("keydown", skip, opts);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arriving]);

  // Station, tumor or the overview. Follows the store's camera focus.
  useEffect(() => {
    // EvidenceDive drives the camera while a dive is active.
    if (useVitra.getState().cameraFocus?.kind === "evidence") {
      flight.current.active = false;
      return;
    }
    if (!controls || !started.current) return;
    const f = flight.current;
    if (inIntro()) {
      if (!cameraStation && !focusTumor) {
        // Viewport changed mid-push: keep going, toward the refitted overview.
        f.toPos.copy(overviewPos.current);
        f.toTarget.copy(overviewTarget.current);
        f.r1 = Math.hypot(f.toPos.x, f.toPos.z);
        return;
      }
      // A focus request (a click, a key or an intake) ends the push and flies straight there.
      f.active = false;
      useArrival.getState().skip();
    }
    if (cameraStation) stationCamera(cameraStation, goalPos.current, goalTarget.current);
    else if (focusTumor) { goalPos.current.copy(TUMOR_VIEW.position); goalTarget.current.copy(TUMOR_VIEW.target); }
    else { goalPos.current.copy(overviewPos.current); goalTarget.current.copy(overviewTarget.current); }
    if (!animate) snapTo(goalPos.current, goalTarget.current);
    else begin(goalPos.current, goalTarget.current, FLIGHT_SECONDS, false);
    // Re-run on viewport changes so the overview refits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraStation, focusTumor, controls, animate, size.width, size.height, railPx]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => { if (!flight.current.arrival) flight.current.active = false; };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  useFrame((_, dt) => {
    // Keep the subject centered in the space left of the rail.
    const wantOffset = size.width > 900 ? ((railPx / 2) / size.width) * camera.filmGauge : 0;
    if (Math.abs(camera.filmOffset - wantOffset) > 1e-3) {
      camera.filmOffset += (wantOffset - camera.filmOffset) * (animate ? 1 - Math.exp(-dt * 6) : 1);
      camera.updateProjectionMatrix();
    }
    const f = flight.current;
    if (!f.active || !controls) return;
    f.t = Math.min(f.duration, f.t + Math.min(dt, 1 / 20));
    const u = f.t / f.duration;
    const e = f.arrival ? easeOutCubic(u) : easeInOutCubic(u);
    // Swing around the lungs: angle and radius in cylindrical coordinates, height linear,
    // with a small lift in the middle of a station-to-station move.
    const a = f.a0 + (f.a1 - f.a0) * e;
    const r = f.r0 + (f.r1 - f.r0) * e;
    const lift = f.arrival ? 0 : Math.sin(Math.PI * e) * 0.9;
    camera.position.set(Math.sin(a) * r, f.fromPos.y + (f.toPos.y - f.fromPos.y) * e + lift, Math.cos(a) * r);
    controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
    controls.update();
    if (u >= 1) {
      f.active = false;
      if (f.arrival) useArrival.getState().finish();
    }
  });

  return null;
}
