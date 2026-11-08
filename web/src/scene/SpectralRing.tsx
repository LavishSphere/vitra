/**
 * Spectral lens ring: five arcs around the lungs, one per aspect. Each arc's color is that
 * aspect's real mean polarity for the current filters and week range (lensSummary, which runs
 * on computeSummary), and it carries one bead per counted quote, sorted from negative to
 * positive. An aspect with no evidence is a faint dashed arc, never a neutral one.
 * The ring sits around the lungs and never touches the lung tissue or the tumor.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  AdditiveBlending, Color, DynamicDrawUsage, Group, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4,
  MeshBasicMaterial, Quaternion, ShaderMaterial, TorusGeometry, Vector3,
} from "three";
import { ASPECTS, type AspectKey } from "@contract/types.ts";
import { useVitra } from "../store/useVitra.ts";
import { lensGhosts, lensSummary, RING_ARC, sliceStart, spinToFront, type LensSlice } from "../data/lens.ts";
import { markPositions } from "./labels.ts";
import { polarityColor, theme } from "./colors.ts";

/** Ring placement in world space. Centered on the lungs, just wider than them. */
export const RING = {
  center: new Vector3(0, -0.42, 0.05),
  radius: 2.78,
  tube: 0.016,
  /** Ring-plane angle that faces the default camera (+z). */
  front: -Math.PI / 2,
};

/** Where the lens readout pins: just under the front of the ring. */
export const RING_FRONT_ANCHOR = new Vector3(RING.center.x, RING.center.y - 0.16, RING.center.z + RING.radius + 0.04);

const BEAD_CAP = 512;
const BEAD_R = 0.032;

function arcMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color() },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
      uEmpty: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uTime;
      uniform float uEmpty;
      varying vec2 vUv;
      void main() {
        float u = vUv.x;
        // Soft ends so arcs read as segments of one dial.
        float ends = smoothstep(0.0, 0.04, u) * smoothstep(1.0, 0.96, u);
        // A slow band of light travels along lit arcs.
        float band = exp(-pow((fract(u - uTime * 0.07) - 0.5) * 7.0, 2.0)) * 0.55;
        float dash = step(0.55, fract(u * 26.0));
        float lit = mix(1.0 + band, dash * 0.45, uEmpty);
        gl_FragColor = vec4(uColor * uIntensity * lit * ends, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

interface Arc {
  aspect: AspectKey;
  mat: ShaderMaterial;
  beads: MeshBasicMaterial;
  level: number; // current lerped intensity
}

export function SpectralRing({ animate, dim = false }: { animate: boolean; dim?: boolean }) {
  const evidence = useVitra((s) => s.evidence);
  const excluded = useVitra((s) => s.excluded);
  const filters = useVitra((s) => s.filters);
  const setFilter = useVitra((s) => s.setFilter);
  const summary = useMemo(() => lensSummary(evidence, excluded, filters), [evidence, excluded, filters]);

  const spin = useRef<Group>(null);
  const spinGoal = useRef(0);
  const beadMeshes = useRef<(InstancedMesh | null)[]>([]);

  const geo = useMemo(() => ({
    arc: new TorusGeometry(RING.radius, RING.tube, 8, 96, RING_ARC),
    hit: new TorusGeometry(RING.radius, 0.13, 6, 48, RING_ARC),
    base: new TorusGeometry(RING.radius, RING.tube * 0.45, 6, 192),
    bead: new IcosahedronGeometry(BEAD_R, 1),
  }), []);
  const arcs = useMemo<Arc[]>(() => ASPECTS.map((aspect) => ({
    aspect,
    mat: arcMaterial(),
    beads: new MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    level: 0,
  })), []);
  const baseMat = useMemo(() => new MeshBasicMaterial({ color: new Color("#334155"), transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }), []);
  const hitMat = useMemo(() => new MeshBasicMaterial({ visible: false }), []);
  useEffect(() => () => {
    Object.values(geo).forEach((g) => g.dispose());
    arcs.forEach((a) => { a.mat.dispose(); a.beads.dispose(); });
    baseMat.dispose();
    hitMat.dispose();
  }, [geo, arcs, baseMat, hitMat]);

  // Arc colors and bead layout follow the data. Nothing here runs per frame.
  useEffect(() => {
    const t = theme();
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3(1, 1, 1);
    const c = new Color();
    summary.slices.forEach((sl: LensSlice, i) => {
      const arc = arcs[i];
      const empty = sl.mean_polarity === null;
      arc.mat.uniforms.uEmpty.value = empty ? 1 : 0;
      if (empty) (arc.mat.uniforms.uColor.value as Color).copy(t.muted).multiplyScalar(0.55);
      else polarityColor(sl.mean_polarity!, arc.mat.uniforms.uColor.value as Color).multiplyScalar(1.25);

      const im = beadMeshes.current[i];
      if (!im) return;
      if (!im.instanceColor) {
        im.instanceColor = new InstancedBufferAttribute(new Float32Array(BEAD_CAP * 3), 3);
        im.instanceColor.setUsage(DynamicDrawUsage);
      }
      const n = Math.min(BEAD_CAP, sl.polarities.length);
      const a0 = sliceStart(i);
      for (let k = 0; k < n; k++) {
        // Spread beads evenly along the arc, leaving the soft ends clear.
        const u = n === 1 ? 0.5 : 0.08 + (0.84 * k) / (n - 1);
        const ang = a0 + u * RING_ARC;
        p.set(Math.cos(ang) * RING.radius, Math.sin(ang) * RING.radius, 0);
        q.identity();
        m.compose(p, q, s);
        im.setMatrixAt(k, m);
        polarityColor(sl.polarities[k], c).multiplyScalar(1.5);
        im.setColorAt(k, c);
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
    });
  }, [summary, arcs]);

  // Bring the focused aspect to the front of the dial.
  useEffect(() => {
    const idx = summary.focus === "all" ? -1 : ASPECTS.indexOf(summary.focus);
    const current = spin.current?.rotation.z ?? 0;
    // "all" keeps the dial where it is.
    spinGoal.current = idx < 0 ? current : spinToFront(idx, RING.front, current);
    if (!animate && spin.current) spin.current.rotation.z = spinGoal.current;
  }, [summary.focus, animate]);

  useFrame((state, dt) => {
    const k = animate ? 1 - Math.exp(-dt * 5) : 1;
    const g = spin.current;
    if (g) g.rotation.z += (spinGoal.current - g.rotation.z) * k;
    const time = animate ? state.clock.elapsedTime : 0;
    const focus = summary.focus;
    const dimK = dim ? 0.3 : 1;
    for (let i = 0; i < arcs.length; i++) {
      const a = arcs[i];
      const target = (focus === "all" ? 0.95 : focus === a.aspect ? 2.1 : 0.2) * dimK;
      a.level += (target - a.level) * k;
      a.mat.uniforms.uIntensity.value = a.level;
      a.mat.uniforms.uTime.value = time;
      a.beads.color.setScalar(Math.min(1.2, 0.25 + a.level * 0.6));
      a.beads.opacity = Math.min(1, 0.2 + a.level * 0.7);
    }
  });

  const pick = (aspect: AspectKey) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    setFilter("aspect", filters.aspect === aspect ? "all" : aspect);
  };
  const over = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = "pointer"; };
  const out = () => { document.body.style.cursor = ""; };

  return (
    <group position={RING.center} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={geo.base} material={baseMat} renderOrder={4} />
      <group ref={spin}>
        {arcs.map((a, i) => (
          <group key={a.aspect} rotation={[0, 0, sliceStart(i)]}>
            <mesh geometry={geo.arc} material={a.mat} renderOrder={5} />
            <mesh
              geometry={geo.hit}
              material={hitMat}
              onClick={pick(a.aspect)}
              onPointerOver={over}
              onPointerOut={out}
            />
          </group>
        ))}
        {arcs.map((a, i) => (
          <instancedMesh
            key={`beads-${a.aspect}`}
            ref={(el) => { beadMeshes.current[i] = el; }}
            args={[geo.bead, a.beads, BEAD_CAP]}
            frustumCulled={false}
            renderOrder={6}
          />
        ))}
      </group>
    </group>
  );
}

/**
 * The lens dims evidence outside the focused aspect instead of hiding it: faint, small,
 * non-interactive copies at the same positions as the real marks. Nothing when the lens is on
 * all aspects.
 */
export function LensGhosts() {
  const marks = useVitra((s) => s.marks);
  const filters = useVitra((s) => s.filters);
  const ghosts = useMemo(() => lensGhosts(marks, filters), [marks, filters]);
  const mesh = useRef<InstancedMesh>(null);
  const dirty = useRef(true);
  const tmp = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), p: new Vector3(), s: new Vector3() }), []);
  const mat = useMemo(() => {
    const c = theme().muted.clone().multiplyScalar(0.42);
    return new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
  }, []);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => { dirty.current = true; }, [ghosts]);

  // Positions come from the evidence layer, which publishes them in its own effect.
  // Reading them in the next frame avoids depending on sibling effect order.
  useFrame(() => {
    const im = mesh.current;
    if (!im || !dirty.current) return;
    dirty.current = false;
    const d = markPositions.data;
    let n = 0;
    for (const g of ghosts) {
      const o = g.index * 3;
      if (o + 2 >= d.length || n >= im.instanceMatrix.count) continue;
      tmp.p.set(d[o], d[o + 1], d[o + 2] - 0.02);
      tmp.s.setScalar(0.05);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      im.setMatrixAt(n++, tmp.m);
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, mat, 1024]} frustumCulled={false} raycast={() => null}>
      <icosahedronGeometry args={[1, 2]} />
    </instancedMesh>
  );
}
