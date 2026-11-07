import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { STATIONS, type StationId } from "../data/stations.ts";
import { useVitra } from "../store/useVitra.ts";
import { FLOOR_Y, JOURNEY_CURVE, PANEL, PLINTH, STATION_FRAMES, weekX } from "./layout.ts";
import { panelMaterial, pathMaterial, plinthMaterial, poolMaterial, ringMaterial } from "./stations/materials.ts";
import { arcLengthTo, buildRibbon } from "./stations/pathGeometry.ts";

const FLAT: [number, number, number] = [-Math.PI / 2, 0, 0];
const POOL_SIZE = PLINTH.radius * 3.2;

function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** One station: a glass plinth on the path, a pool of light under it, and its panel above. */
function Station({ id, index, animate }: { id: StationId; index: number; animate: boolean }) {
  const frame = STATION_FRAMES[index];
  const mats = useMemo(
    () => ({ panel: panelMaterial(), plinth: plinthMaterial(), ring: ringMaterial(), pool: poolMaterial() }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const focus = useVitra((s) => s.focusStation);
  const setFocus = useVitra((s) => s.setFocusStation);
  const setFocusTumor = useVitra((s) => s.setFocusTumor);
  const weeks = useVitra((s) => s.weeks);
  const from = useVitra((s) => s.filters.weekFrom);
  const to = useVitra((s) => s.filters.weekTo);
  const isFocus = focus === id;
  const dimmed = focus !== null && !isFocus;
  const hover = useRef(false);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    setFocusTumor(false);
    setFocus(isFocus ? null : id);
  };
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hover.current = true;
    document.body.style.cursor = "pointer";
  };
  const onOut = () => {
    hover.current = false;
    document.body.style.cursor = "";
  };

  // The selected week range, in panel-local x.
  const range = useRef<[number, number]>([0, 0]);
  useEffect(() => {
    const n = weeks.length;
    const i0 = Math.max(0, weeks.indexOf(from));
    const i1 = Math.max(0, weeks.indexOf(to));
    const half = n > 1 ? (PANEL.width - PANEL.padX * 2) / (n - 1) / 2 : PANEL.width / 2;
    range.current = [i0 <= 0 ? -PANEL.width / 2 : weekX(i0, n) - half, i1 >= n - 1 ? PANEL.width / 2 : weekX(i1, n) + half];
  }, [weeks, from, to]);

  useFrame((_, dt) => {
    const k = animate ? 1 - Math.exp(-dt * 6) : 1;
    const f = isFocus ? 1 : 0;
    const d = dimmed ? 1 : 0;
    const h = hover.current ? 1 : 0;
    const pu = mats.panel.uniforms;
    pu.uFocus.value += (f - pu.uFocus.value) * k;
    pu.uDim.value += (d - pu.uDim.value) * k;
    pu.uHover.value += (h - pu.uHover.value) * k;
    const r = pu.uRange.value as number[];
    r[0] += (range.current[0] - r[0]) * k;
    r[1] += (range.current[1] - r[1]) * k;
    for (const m of [mats.plinth, mats.ring, mats.pool]) {
      const u = m.uniforms;
      u.uFocus.value = pu.uFocus.value;
      u.uDim.value = pu.uDim.value;
      if (u.uHover) u.uHover.value = pu.uHover.value;
    }
  });

  const base = frame.base;
  return (
    <group>
      <mesh position={[base.x, FLOOR_Y + 0.004, base.z]} rotation={FLAT} material={mats.pool} renderOrder={-2}>
        <planeGeometry args={[POOL_SIZE, POOL_SIZE]} />
      </mesh>
      <mesh
        position={[base.x, FLOOR_Y + PLINTH.height / 2, base.z]}
        material={mats.plinth}
        renderOrder={-1}
        onClick={onClick}
        onPointerOver={onOver}
        onPointerOut={onOut}
      >
        <cylinderGeometry args={[PLINTH.radius, PLINTH.radius * 1.04, PLINTH.height, 72, 1]} />
      </mesh>
      <mesh position={[base.x, FLOOR_Y + PLINTH.height + 0.003, base.z]} rotation={FLAT} material={mats.ring} renderOrder={-1}>
        <ringGeometry args={[PLINTH.radius - 0.022, PLINTH.radius, 96]} />
      </mesh>
      <group position={frame.position} quaternion={frame.quaternion}>
        <mesh material={mats.panel} renderOrder={0} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
          <planeGeometry args={[PANEL.width, PANEL.height]} />
        </mesh>
      </group>
    </group>
  );
}

/** The path the stations stand on, from under the lungs toward the viewer. */
function JourneyRibbon({ animate }: { animate: boolean }) {
  const { geometry, material, reach } = useMemo(() => {
    const { geometry, length } = buildRibbon(JOURNEY_CURVE, 0.42, 480);
    const reach = Object.fromEntries(STATION_FRAMES.map((f) => [f.id, arcLengthTo(JOURNEY_CURVE, f.base)])) as Record<StationId, number>;
    return { geometry, material: pathMaterial(length), reach };
  }, []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  const focus = useVitra((s) => s.focusStation);
  useFrame((state, dt) => {
    const u = material.uniforms;
    if (animate) u.uTime.value = state.clock.elapsedTime;
    const k = animate ? 1 - Math.exp(-dt * 3) : 1;
    // Keep the last reach while fading out, so the route dims in place.
    if (focus) u.uReach.value += (reach[focus] - u.uReach.value) * k;
    u.uReachAmt.value += ((focus ? 1 : 0) - u.uReachAmt.value) * k;
  });
  return <mesh geometry={geometry} material={material} position={[0, 0.002, 0]} renderOrder={-3} />;
}

export function Stations({ animate = true }: { animate?: boolean }) {
  const reduced = useReducedMotion();
  const moving = animate && !reduced;
  return (
    <group>
      <JourneyRibbon animate={moving} />
      {STATIONS.map((s, i) => <Station key={s.id} id={s.id} index={i} animate={moving} />)}
    </group>
  );
}
