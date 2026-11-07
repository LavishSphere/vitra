import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useVitra } from "../store/useVitra.ts";
import { OVERVIEW, TUMOR_VIEW, stationCamera } from "./layout.ts";

/** Flies the camera between waypoints. Any user drag cancels the flight. */
export function CameraRig({ animate, railPx }: { animate: boolean; railPx: number }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const size = useThree((s) => s.size);
  const focusStation = useVitra((s) => s.focusStation);
  const focusTumor = useVitra((s) => s.focusTumor);

  const goalPos = useRef(OVERVIEW.position.clone());
  const goalTarget = useRef(OVERVIEW.target.clone());
  const flying = useRef(false);

  useEffect(() => {
    if (focusStation) stationCamera(focusStation, goalPos.current, goalTarget.current);
    else if (focusTumor) { goalPos.current.copy(TUMOR_VIEW.position); goalTarget.current.copy(TUMOR_VIEW.target); }
    else {
      // Pull back on narrow viewports so the five stations still fit.
      const aspect = Math.max(0.3, (size.width - railPx) / Math.max(1, size.height));
      const fit = Math.min(1.5, Math.max(1, 1.15 / aspect));
      goalPos.current.copy(OVERVIEW.position).sub(OVERVIEW.target).multiplyScalar(fit).add(OVERVIEW.target);
      goalTarget.current.copy(OVERVIEW.target);
    }
    flying.current = true;
  }, [focusStation, focusTumor, size.width, size.height, railPx]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => { flying.current = false; };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  const scratch = useRef(new Vector3());

  useFrame((_, dt) => {
    // Keep the subject centered in the space left of the rail.
    const wantOffset = size.width > 900 ? ((railPx / 2) / size.width) * camera.filmGauge : 0;
    if (Math.abs(camera.filmOffset - wantOffset) > 1e-3) {
      camera.filmOffset += (wantOffset - camera.filmOffset) * (animate ? 1 - Math.exp(-dt * 6) : 1);
      camera.updateProjectionMatrix();
    }
    if (!flying.current || !controls) return;
    const k = animate ? 1 - Math.exp(-dt * 2.4) : 1;
    camera.position.lerp(goalPos.current, k);
    controls.target.lerp(goalTarget.current, k);
    controls.update();
    if (scratch.current.copy(camera.position).sub(goalPos.current).lengthSq() < 1e-4) flying.current = false;
  });

  return null;
}
