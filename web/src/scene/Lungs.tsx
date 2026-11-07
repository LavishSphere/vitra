import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Color, Group } from "three";
import { airwayGeometry, airwayTree, flowPaths, lungGeometry, samplePath } from "./anatomy.ts";
import { airwayMaterial, flowMaterial, glassMaterial } from "./materials.ts";
import { theme } from "./colors.ts";
import { useVitra } from "../store/useVitra.ts";
import { Tumor } from "./Tumor.tsx";

/** Breathing period in seconds. Exposed so other views can stay in phase. */
export const BREATH_PERIOD = 5.6;

/** Eased 0..1 breathing phase (0 = exhaled). */
export function breathAt(t: number): number {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / BREATH_PERIOD);
}

export function accentFor(product: "A" | "B" | "all", out: Color): Color {
  const t = theme();
  if (product === "A") return out.copy(t.cyan);
  if (product === "B") return out.copy(t.blue);
  return out.copy(t.cyan).lerp(t.blue, 0.35);
}

const FLOW_COUNT = 900;

interface LungsProps {
  /**
   * Optional replacement for the procedural lung surfaces (for example a licensed GLB).
   * The airway tree, airflow and tumor hotspot stay, so the scene keeps its meaning.
   */
  surface?: ReactNode;
  animate: boolean;
}

export function Lungs({ surface, animate }: LungsProps) {
  const group = useRef<Group>(null);
  const product = useVitra((s) => s.filters.product);
  const focusStation = useVitra((s) => s.focusStation);

  const { right, left, airways, paths } = useMemo(() => {
    const tree = airwayTree();
    return { right: lungGeometry("right"), left: lungGeometry("left"), airways: airwayGeometry(tree), paths: flowPaths(tree) };
  }, []);

  const startAccent = useMemo(() => accentFor("all", new Color()), []);
  const glass = useMemo(() => glassMaterial(startAccent), [startAccent]);
  const airMat = useMemo(() => airwayMaterial(startAccent), [startAccent]);
  const flowMat = useMemo(() => flowMaterial(new Color("#BFFBF3").multiplyScalar(1.6), 0.085), []);

  // Airflow particles: each rides a root-to-leaf airway path and moves in and out with the breath.
  const flow = useMemo(() => {
    const geo = new BufferGeometry();
    const pos = new Float32Array(FLOW_COUNT * 3);
    const seed = new Float32Array(FLOW_COUNT);
    const pathIdx = new Uint16Array(FLOW_COUNT);
    const base = new Float32Array(FLOW_COUNT);
    let s = 1234567;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < FLOW_COUNT; i++) {
      pathIdx[i] = Math.floor(rnd() * paths.length);
      base[i] = 0.12 + rnd() * 0.8;
      seed[i] = rnd();
      samplePath(paths[pathIdx[i]], base[i], pos, i * 3);
    }
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new BufferAttribute(seed, 1));
    geo.computeBoundingSphere();
    return { geo, pos, pathIdx, base, seed };
  }, [paths]);

  useEffect(() => () => {
    right.dispose(); left.dispose(); airways.dispose(); flow.geo.dispose();
    glass.dispose(); airMat.dispose(); flowMat.dispose();
  }, [right, left, airways, flow, glass, airMat, flowMat]);

  const target = useRef(new Color());
  const dim = useRef(0);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const b = animate ? breathAt(t) : 0.35;
    const g = group.current;
    if (g) {
      // Breathing: the lungs widen a little and lengthen toward the diaphragm.
      g.scale.set(1 + 0.022 * b, 1 + 0.035 * b, 1 + 0.022 * b);
      g.position.y = -0.035 * b * 2.0;
    }
    accentFor(product, target.current);
    const k = 1 - Math.exp(-dt * 3);
    (glass.uniforms.uAccent.value as Color).lerp(target.current, k);
    (airMat.uniforms.uAccent.value as Color).lerp(target.current, k);
    dim.current += ((focusStation ? 1 : 0) - dim.current) * k;
    glass.uniforms.uFocus.value = dim.current;
    airMat.uniforms.uOpacity.value = 1 - 0.4 * dim.current;
    flowMat.uniforms.uOpacity.value = 1 - 0.5 * dim.current;

    if (animate) {
      const { pos, pathIdx, base, seed } = flow;
      for (let i = 0; i < FLOW_COUNT; i++) {
        // Tidal flow: deeper on inhale, back out on exhale. Small per-particle lag.
        const lag = breathAt(t - seed[i] * 0.6);
        samplePath(paths[pathIdx[i]], base[i] + (lag - 0.5) * 0.22, pos, i * 3);
      }
      (flow.geo.attributes.position as BufferAttribute).needsUpdate = true;
    }
  });

  return (
    <group ref={group}>
      {surface ?? (
        <>
          <mesh geometry={right} material={glass} renderOrder={2} />
          <mesh geometry={left} material={glass} renderOrder={2} />
        </>
      )}
      <mesh geometry={airways} material={airMat} renderOrder={1} />
      <points geometry={flow.geo} material={flowMat} renderOrder={3} frustumCulled={false} />
      <Tumor animate={animate} />
    </group>
  );
}
