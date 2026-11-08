import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { AdditiveBlending, Color, Group, Mesh, QuadraticBezierCurve3, ShaderMaterial, Vector3 } from "three";
import { TUMOR_POSITION } from "./anatomy.ts";
import { useVitra } from "../store/useVitra.ts";
import { haloMaterial } from "./materials.ts";
import { PANEL, frameOf, markWorldPosition } from "./layout.ts";
import { polarityColor } from "./colors.ts";

const POOL = 6;
const TRAIL = 10;
/** Seconds from the lungs to the station. Evidence.tsx reveals the mark when the head lands. */
export const PULSE_TRAVEL = 1.6;
const RIPPLE = 1.3;
const FLASH = 1.6;
/** Evidence flows out from the lungs: every pulse starts at the tumor hotspot. */
const START = TUMOR_POSITION.clone();
const WHITE = new Color("#ffffff");

/** Rounded-rectangle edge glow that sits on a station panel for a moment when evidence lands. */
function frameFlashMaterial(): ShaderMaterial {
  const pad = 0.16;
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color() }, uStrength: { value: 0 }, uSize: { value: [PANEL.width + pad * 2, PANEL.height + pad * 2] } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform vec2 uSize;
      varying vec2 vUv;
      float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
      void main() {
        vec2 p = (vUv - 0.5) * uSize;
        float d = sdRound(p, uSize * 0.5 - 0.1, 0.16);
        float line = exp(-abs(d) * 34.0);
        float glow = exp(-max(d, 0.0) * 9.0) * step(0.0, d) * 0.35;
        gl_FragColor = vec4(uColor * (line + glow) * uStrength, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

/**
 * Evidence pulse: fired by the store after a classified transcript is incorporated and the
 * trends recomputed. One light per new quote leaves the lungs and lands on its own station and
 * week, only at stations the intake touched. Pulses for later stations wait their turn.
 */
export function Pulses() {
  const pulses = useVitra((s) => s.pulses);
  const weeks = useVitra((s) => s.weeks);
  const heads = useRef<(Group | null)[]>([]);
  const trails = useRef<(Group | null)[][]>(Array.from({ length: POOL }, () => []));
  const ripples = useRef<(Mesh | null)[]>([]);
  const flashes = useRef<(Mesh | null)[]>([]);

  const mats = useMemo(() => Array.from({ length: POOL }, () => ({
    head: haloMaterial(new Color(), 1.6),
    trail: Array.from({ length: TRAIL }, () => haloMaterial(new Color(), 1)),
    ripple: haloMaterial(new Color(), 1),
    flash: frameFlashMaterial(),
  })), []);
  useEffect(() => () => {
    for (const m of mats) { m.head.dispose(); m.ripple.dispose(); m.flash.dispose(); m.trail.forEach((t) => t.dispose()); }
  }, [mats]);

  const curves = useMemo(() => {
    const c = new Color();
    return pulses.slice(-POOL).map((p) => {
      const end = markWorldPosition(p.station, Math.max(0, weeks.indexOf(p.week)), weeks.length, p.polarity, new Vector3());
      const mid = START.clone().lerp(end, 0.5).setY(Math.max(START.y, end.y) + 2.4);
      polarityColor(p.polarity, c);
      return { pulse: p, curve: new QuadraticBezierCurve3(START, mid, end), end, color: c.clone() };
    });
  }, [pulses, weeks]);

  // Colors and the station frame placement change only when the pulse list changes.
  useEffect(() => {
    for (let i = 0; i < POOL; i++) {
      const c = curves[i];
      const m = mats[i];
      if (!c) continue;
      (m.head.uniforms.uColor.value as Color).copy(c.color).lerp(WHITE, 0.35).multiplyScalar(2.2);
      for (const t of m.trail) (t.uniforms.uColor.value as Color).copy(c.color).multiplyScalar(1.6);
      (m.ripple.uniforms.uColor.value as Color).copy(c.color).multiplyScalar(1.4);
      (m.flash.uniforms.uColor.value as Color).copy(c.color).multiplyScalar(1.2);
      const f = flashes.current[i];
      if (f) {
        const fr = frameOf(c.pulse.station);
        f.position.copy(fr.position).addScaledVector(fr.outward, 0.02);
        f.quaternion.copy(fr.quaternion);
      }
    }
  }, [curves, mats]);

  const tmp = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const now = performance.now();
    for (let i = 0; i < POOL; i++) {
      const h = heads.current[i];
      const r = ripples.current[i];
      const f = flashes.current[i];
      const tr = trails.current[i];
      const c = curves[i];
      const m = mats[i];
      if (!h || !r || !f) continue;
      const t = c ? (now - c.pulse.startedAt) / 1000 : -1;
      const flying = !!c && t >= 0 && t < PULSE_TRAVEL;
      h.visible = flying;
      for (let k = 0; k < TRAIL; k++) {
        const g = tr[k];
        if (!g) continue;
        const u = (t - (k + 1) * 0.045) / PULSE_TRAVEL;
        g.visible = flying && u > 0;
        if (g.visible && c) {
          c.curve.getPoint(easeInOut(Math.min(1, u)), tmp);
          g.position.copy(tmp);
          const s = 0.42 * (1 - k / TRAIL);
          g.scale.set(s, s, s);
          m.trail[k].uniforms.uStrength.value = 0.9 * (1 - k / TRAIL);
        }
      }
      if (flying && c) {
        c.curve.getPoint(easeInOut(t / PULSE_TRAVEL), tmp);
        h.position.copy(tmp);
      }
      const landed = t - PULSE_TRAVEL;
      r.visible = !!c && landed >= 0 && landed < RIPPLE;
      if (r.visible && c) {
        const u = landed / RIPPLE;
        r.position.copy(c.end);
        const s = 0.25 + (1 - Math.pow(1 - u, 3)) * 1.5;
        r.scale.set(s, s, s);
        m.ripple.uniforms.uStrength.value = 1.5 * (1 - u);
      }
      f.visible = !!c && landed >= 0 && landed < FLASH;
      if (f.visible) m.flash.uniforms.uStrength.value = 1.1 * Math.pow(1 - landed / FLASH, 1.6);
    }
  });

  return (
    <group>
      {mats.map((m, i) => (
        <group key={i}>
          <group ref={(g) => { heads.current[i] = g; }} visible={false}>
            <Billboard>
              <mesh material={m.head}><planeGeometry args={[0.8, 0.8]} /></mesh>
            </Billboard>
          </group>
          {m.trail.map((tm, k) => (
            <group key={k} ref={(g) => { trails.current[i][k] = g; }} visible={false}>
              <Billboard>
                <mesh material={tm}><planeGeometry args={[1, 1]} /></mesh>
              </Billboard>
            </group>
          ))}
          <Billboard>
            <mesh ref={(mm) => { ripples.current[i] = mm; }} material={m.ripple} visible={false}>
              <ringGeometry args={[0.42, 0.5, 64]} />
            </mesh>
          </Billboard>
          <mesh ref={(mm) => { flashes.current[i] = mm; }} material={m.flash} visible={false}>
            <planeGeometry args={[PANEL.width + 0.32, PANEL.height + 0.32]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
