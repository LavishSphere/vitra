import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, ShaderMaterial } from "three";
import { STATIONS, type StationId } from "../data/stations.ts";
import { useVitra } from "../store/useVitra.ts";
import { PANEL, STATION_FRAMES, weekX } from "./layout.ts";

function panelMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uSize: { value: [PANEL.width, PANEL.height] },
      uStep: { value: PANEL.polarityStep },
      uRange: { value: [-PANEL.width / 2, PANEL.width / 2] },
      uEdge: { value: new Color("#7c8aa5") },
      uFocus: { value: 0 },
      uDim: { value: 0 },
      uPos: { value: new Color("#42e8d3") },
      uNeg: { value: new Color("#f16c91") },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec2 uSize;
      uniform float uStep;
      uniform vec2 uRange;
      uniform vec3 uEdge;
      uniform float uFocus;
      uniform float uDim;
      uniform vec3 uPos;
      uniform vec3 uNeg;
      varying vec2 vUv;
      float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
      void main() {
        vec2 p = (vUv - 0.5) * uSize;
        float d = sdRound(p, uSize * 0.5, 0.12);
        float aa = fwidth(d);
        float inside = 1.0 - smoothstep(-aa, aa, d);
        float edge = (1.0 - smoothstep(0.0, aa * 1.5, abs(d + aa))) ;
        // Polarity guides at -2..+2. Zero is the brightest; the band tints toward its sign.
        float lines = 0.0;
        for (int k = -2; k <= 2; k++) {
          float y = float(k) * uStep;
          float w = fwidth(p.y);
          float l = 1.0 - smoothstep(0.0, w * 1.2, abs(p.y - y));
          lines += l * (k == 0 ? 0.55 : 0.2);
        }
        float inX = step(uRange.x, p.x) * step(p.x, uRange.y);
        float band = inX * 0.025;
        vec3 tint = p.y > 0.0 ? uPos : uNeg;
        float grad = smoothstep(0.0, uStep * 2.4, abs(p.y)) * 0.012 * inX;
        vec3 col = vec3(0.05, 0.07, 0.12) * 0.3;
        col += uEdge * lines * (0.45 + 0.25 * inX);
        col += uEdge * band;
        col += tint * grad;
        col += mix(uEdge, vec3(0.506, 0.549, 0.973), uFocus) * edge * (0.55 + 0.6 * uFocus);
        float a = inside * (1.0 - 0.6 * uDim);
        gl_FragColor = vec4(col * a, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

function StationPanel({ id, index }: { id: StationId; index: number }) {
  const frame = STATION_FRAMES[index];
  const mat = useMemo(() => panelMaterial(), []);
  useEffect(() => () => mat.dispose(), [mat]);

  const focus = useVitra((s) => s.focusStation);
  const weeks = useVitra((s) => s.weeks);
  const from = useVitra((s) => s.filters.weekFrom);
  const to = useVitra((s) => s.filters.weekTo);
  const isFocus = focus === id;
  const dimmed = focus !== null && !isFocus;

  const range = useRef<[number, number]>([0, 0]);
  useEffect(() => {
    const n = weeks.length;
    const i0 = Math.max(0, weeks.indexOf(from));
    const i1 = Math.max(0, weeks.indexOf(to));
    const half = n > 1 ? (PANEL.width - PANEL.padX * 2) / (n - 1) / 2 : PANEL.width / 2;
    range.current = [i0 <= 0 ? -PANEL.width / 2 : weekX(i0, n) - half, i1 >= n - 1 ? PANEL.width / 2 : weekX(i1, n) + half];
  }, [weeks, from, to]);

  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 6);
    const u = mat.uniforms;
    u.uFocus.value += ((isFocus ? 1 : 0) - u.uFocus.value) * k;
    u.uDim.value += ((dimmed ? 1 : 0) - u.uDim.value) * k;
    const r = u.uRange.value as number[];
    r[0] += (range.current[0] - r[0]) * k;
    r[1] += (range.current[1] - r[1]) * k;
  });

  return (
    <group position={frame.position} quaternion={frame.quaternion}>
      <mesh material={mat} renderOrder={0}>
        <planeGeometry args={[PANEL.width, PANEL.height]} />
      </mesh>
    </group>
  );
}

export function Stations() {
  return (
    <group>
      {STATIONS.map((s, i) => <StationPanel key={s.id} id={s.id} index={i} />)}
    </group>
  );
}
