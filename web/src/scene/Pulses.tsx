import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { Color, Group, Mesh, QuadraticBezierCurve3, Vector3 } from "three";
import { useVitra } from "../store/useVitra.ts";
import { haloMaterial } from "./materials.ts";
import { markWorldPosition } from "./layout.ts";

const POOL = 6;
const TRAVEL = 1.8;
const RIPPLE = 1.1;

/**
 * Evidence pulse: fired by the store when a classified transcript has been incorporated and
 * the trends recomputed. A light travels from the lungs to the station and week it changed.
 */
export function Pulses() {
  const pulses = useVitra((s) => s.pulses);
  const weeks = useVitra((s) => s.weeks);
  const heads = useRef<(Group | null)[]>([]);
  const ripples = useRef<(Mesh | null)[]>([]);
  const headMat = useMemo(() => haloMaterial(new Color("#a5b4fc").multiplyScalar(2.2), 1.4), []);
  const rippleMats = useMemo(() => Array.from({ length: POOL }, () => haloMaterial(new Color("#a5b4fc"), 1)), []);
  useEffect(() => () => { headMat.dispose(); rippleMats.forEach((m) => m.dispose()); }, [headMat, rippleMats]);

  const curves = useMemo(() => {
    const start = new Vector3(0, 0.4, 0.2);
    return pulses.slice(-POOL).map((p) => {
      const end = markWorldPosition(p.station, Math.max(0, weeks.indexOf(p.week)), weeks.length, p.polarity, new Vector3());
      const mid = start.clone().lerp(end, 0.5).setY(Math.max(start.y, end.y) + 2.2);
      return { pulse: p, curve: new QuadraticBezierCurve3(start, mid, end), end };
    });
  }, [pulses, weeks]);

  const tmp = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const now = performance.now();
    for (let i = 0; i < POOL; i++) {
      const h = heads.current[i];
      const r = ripples.current[i];
      const c = curves[i];
      if (!h || !r) continue;
      if (!c) { h.visible = false; r.visible = false; continue; }
      const t = (now - c.pulse.startedAt) / 1000;
      if (t < TRAVEL) {
        const u = t / TRAVEL;
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        c.curve.getPoint(e, tmp);
        h.position.copy(tmp);
        h.visible = true;
        r.visible = false;
      } else if (t < TRAVEL + RIPPLE) {
        h.visible = false;
        const u = (t - TRAVEL) / RIPPLE;
        r.visible = true;
        r.position.copy(c.end);
        const s = 0.3 + u * 1.6;
        r.scale.set(s, s, s);
        rippleMats[i].uniforms.uStrength.value = 1.4 * (1 - u);
      } else {
        h.visible = false;
        r.visible = false;
      }
    }
  });

  return (
    <group>
      {Array.from({ length: POOL }, (_, i) => (
        <group key={i}>
          <group ref={(g) => { heads.current[i] = g; }} visible={false}>
            <Billboard>
              <mesh material={headMat}><planeGeometry args={[0.7, 0.7]} /></mesh>
            </Billboard>
          </group>
          <Billboard>
            <mesh ref={(m) => { ripples.current[i] = m; }} material={rippleMats[i]} visible={false}>
              <ringGeometry args={[0.42, 0.5, 64]} />
            </mesh>
          </Billboard>
        </group>
      ))}
    </group>
  );
}
