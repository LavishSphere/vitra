import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { markPositions } from "./labels.ts";
import { Color, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3, DynamicDrawUsage, InstancedBufferAttribute } from "three";
import { useVitra, type Mark } from "../store/useVitra.ts";

import { PANEL, frameOf, weekX } from "./layout.ts";
import { polarityColor, theme } from "./colors.ts";
import { haloMaterial } from "./materials.ts";
import { PULSE_TRAVEL } from "./Pulses.tsx";

const CAPACITY = 1024;
const BASE = 0.085;

interface Layout { positions: Float32Array; count: number; }

/** World position for each mark: station panel, x = week, y = polarity, stacked when they collide. */
function layoutMarks(marks: Mark[], weeks: string[]): Layout {
  const positions = new Float32Array(CAPACITY * 3);
  const stacks = new Map<string, number>();
  const v = new Vector3();
  const n = weeks.length;
  const weekIdx = new Map(weeks.map((w, i) => [w, i]));
  for (const m of marks) {
    if (m.index >= CAPACITY) continue;
    const wi = weekIdx.get(m.item.iso_week) ?? 0;
    const key = `${m.station}|${wi}|${m.aspect.polarity}`;
    const k = stacks.get(key) ?? 0;
    stacks.set(key, k + 1);
    const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2);
    v.set(weekX(wi, n), m.aspect.polarity * PANEL.polarityStep + off * 0.055, 0.1 + Math.abs(off) * 0.12);
    v.applyMatrix4(frameOf(m.station).matrix);
    positions.set([v.x, v.y, v.z], m.index * 3);
  }
  return { positions, count: Math.min(CAPACITY, marks.reduce((mx, m) => Math.max(mx, m.index + 1), 0)) };
}

export function Evidence({ animate }: { animate: boolean }) {
  const mesh = useRef<InstancedMesh>(null);
  const marks = useVitra((s) => s.marks);
  const weeks = useVitra((s) => s.weeks);
  const hovered = useVitra((s) => s.hovered);
  const selection = useVitra((s) => s.selection);
  const hover = useVitra((s) => s.hover);
  const pulses = useVitra((s) => s.pulses);

  const layout = useMemo(() => layoutMarks(marks, weeks), [marks, weeks]);
  useEffect(() => { markPositions.data = layout.positions; }, [layout]);
  const byIndex = useMemo(() => {
    const arr: (Mark | undefined)[] = new Array(CAPACITY);
    for (const m of marks) arr[m.index] = m;
    return arr;
  }, [marks]);

  const scales = useRef(new Float32Array(CAPACITY));
  const tmp = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), p: new Vector3(), s: new Vector3(), c: new Color() }), []);
  const ring = useRef<Mesh>(null);
  const ringMat = useMemo(() => haloMaterial(new Color("#a5b4fc"), 1.2), []);
  useEffect(() => () => ringMat.dispose(), [ringMat]);

  // Colors change only when marks change, not per frame.
  useEffect(() => {
    const im = mesh.current;
    if (!im) return;
    if (!im.instanceColor) {
      im.instanceColor = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
      im.instanceColor.setUsage(DynamicDrawUsage);
    }
    const t = theme();
    for (const m of marks) {
      if (m.index >= CAPACITY) continue;
      if (m.excluded) tmp.c.copy(t.muted).multiplyScalar(0.32);
      else polarityColor(m.aspect.polarity, tmp.c).multiplyScalar(1.35);
      im.setColorAt(m.index, tmp.c);
    }
    im.instanceColor.needsUpdate = true;
    im.count = layout.count;
  }, [marks, layout, tmp]);

  const selMark = useMemo(
    () => (selection ? marks.find((m) => m.item.item_id === selection.itemId && (!selection.aspect || m.aspect.aspect === selection.aspect)) : undefined),
    [marks, selection],
  );
  const selectedKey = selMark?.key;

  // A new transcript quote stays hidden until its pulse lands, then pops in and settles.
  const landAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pulses) m.set(`${p.itemId}:${p.aspect}`, p.startedAt + PULSE_TRAVEL * 1000);
    return m;
  }, [pulses]);

  useFrame((state, dt) => {
    const im = mesh.current;
    if (!im) return;
    const k = animate ? 1 - Math.exp(-dt * 8) : 1;
    const sc = scales.current;
    const pos = layout.positions;
    const t = state.clock.elapsedTime;
    const now = performance.now();
    let dirty = false;
    for (let i = 0; i < layout.count; i++) {
      const m = byIndex[i];
      let target = 0;
      if (m && m.visible) {
        target = m.excluded ? 0.75 : 1;
        if (m.key === hovered) target = 1.6;
        if (m.key === selectedKey) target = 1.9;
        const land = animate ? landAt.get(m.key) : undefined;
        if (land !== undefined) {
          const since = now - land;
          if (since < 0) target = 0;
          else if (since < 900) target = Math.max(target, 2.2);
        }
      }
      const prev = sc[i];
      const next = prev + (target - prev) * k;
      if (Math.abs(next - prev) < 1e-4 && !(animate && m?.visible)) continue;
      sc[i] = next;
      // A barely-there drift (0.012 units) keeps marks from looking frozen, still readable.
      const drift = animate && m ? Math.sin(t * 0.8 + i * 1.7) * 0.012 : 0;
      tmp.p.set(pos[i * 3], pos[i * 3 + 1] + drift, pos[i * 3 + 2]);
      const s = BASE * next;
      tmp.s.set(s, s, s);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      im.setMatrixAt(i, tmp.m);
      dirty = true;
    }
    if (dirty) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
    const r = ring.current;
    if (r) {
      const sel = selMark;
      r.visible = !!sel && sel.visible;
      if (sel) r.position.set(pos[sel.index * 3], pos[sel.index * 3 + 1], pos[sel.index * 3 + 2] + 0.01);
    }
  });

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const m = e.instanceId !== undefined ? byIndex[e.instanceId] : undefined;
    if (m && m.visible) { hover(m.key); document.body.style.cursor = "pointer"; }
  };
  const onOut = () => { hover(null); document.body.style.cursor = ""; };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const m = e.instanceId !== undefined ? byIndex[e.instanceId] : undefined;
    if (!m || !m.visible) return;
    // Primary path opens the source with the quote marked. Shift-click keeps the spectral dive.
    if (e.nativeEvent.shiftKey) useVitra.getState().diveTo(m.item.item_id, m.aspect.aspect);
    else useVitra.getState().select({ itemId: m.item.item_id, aspect: m.aspect.aspect });
  };

  return (
    <>
      <instancedMesh
        ref={mesh}
        args={[undefined, undefined, CAPACITY]}
        onPointerMove={onMove}
        onPointerOut={onOut}
        onClick={onClick}
        frustumCulled={false}
      >
        <icosahedronGeometry args={[1, 3]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <Billboard>
        <mesh ref={ring} material={ringMat} visible={false}>
          <ringGeometry args={[0.2, 0.26, 48]} />
        </mesh>
      </Billboard>
    </>
  );
}
