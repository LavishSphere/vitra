/**
 * Lung-safety pins: one small glowing pin per evidence item whose verified quote or source text
 * mentions ILD, interstitial lung disease, pneumonitis or lung toxicity. All four labels list
 * ILD/pneumonitis as a warning.
 *
 * Placement is illustrative: a seeded spot on the lung surface per item_id. It carries no
 * anatomical meaning. Color is the item's polarity (muted when only the source text matches).
 *
 * <LungPins> goes inside the canvas (ideally inside the breathing lung group).
 * <LungPinLabels> goes next to <SceneLabels> in the DOM: focusable pins, tooltip and the toggle.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { create } from "zustand";
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DynamicDrawUsage, Group,
  IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion,
  RingGeometry, ShaderMaterial, Vector3, DoubleSide,
} from "three";
import { lungGeometry, TUMOR_POSITION } from "./anatomy.ts";
import { polarityColor, theme } from "./colors.ts";
import { anchorRef } from "./labels.ts";
import { useVitra } from "../store/useVitra.ts";
import { lungSafetyEvidence, pinSpot, splitOnTerm, type LungSafetyHit, type PinSpot, type SurfaceSamples } from "../data/lungSafety.ts";
import { POLARITY_WORD, signedPolarity } from "../lib/format.ts";
import { polarityCss } from "../theme.ts";

export const PLACEMENT_NOTE = "Illustrative placement. A pin's spot on the lung carries no anatomical meaning.";

const STEM = 0.2;
const HEAD = 0.078;
const HIT = 0.18;

// ---------------------------------------------------------------------------------------------
// Local UI state. Kept out of the main store so the pins add no fields other views depend on.

interface PinState {
  show: boolean;
  hovered: string | null;
  setShow(on: boolean): void;
  setHovered(id: string | null): void;
}

export const useLungPins = create<PinState>((set, get) => ({
  show: true,
  hovered: null,
  setShow(on) { set({ show: on, hovered: on ? get().hovered : null }); },
  setHovered(id) { if (get().hovered !== id) set({ hovered: id }); },
}));

/** Lung-safety hits under the current product and week filters. */
export function useLungSafetyHits(): LungSafetyHit[] {
  const evidence = useVitra((s) => s.evidence);
  const product = useVitra((s) => s.filters.product);
  const weekFrom = useVitra((s) => s.filters.weekFrom);
  const weekTo = useVitra((s) => s.filters.weekTo);
  return useMemo(() => lungSafetyEvidence(evidence, { product, weekFrom, weekTo }), [evidence, product, weekFrom, weekTo]);
}

// ---------------------------------------------------------------------------------------------
// Surface samples from the same procedural lungs the scene draws. Built once, then the
// geometries are disposed and only the packed arrays stay.

let surfaceCache: SurfaceSamples | null = null;
function lungSurface(): SurfaceSamples {
  if (surfaceCache) return surfaceCache;
  const parts = [lungGeometry("right"), lungGeometry("left")];
  const count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    positions.set(g.attributes.position.array as Float32Array, o);
    normals.set(g.attributes.normal.array as Float32Array, o);
    o += g.attributes.position.count * 3;
    g.dispose();
  }
  surfaceCache = { positions, normals, count };
  return surfaceCache;
}

const AVOID = { x: TUMOR_POSITION.x, y: TUMOR_POSITION.y, z: TUMOR_POSITION.z, radius: 0.95 };

const spotCache = new Map<string, PinSpot>();
export function spotFor(itemId: string): PinSpot {
  let s = spotCache.get(itemId);
  if (!s) {
    s = pinSpot(itemId, lungSurface(), { avoid: AVOID, yRange: [-2.3, 0.7] });
    spotCache.set(itemId, s);
  }
  return s;
}

/** World-space head positions, written by <LungPins> each frame and read by the DOM labels. */
const anchorsById = new Map<string, Vector3>();
export function pinAnchor(itemId: string): Vector3 {
  let v = anchorsById.get(itemId);
  if (!v) {
    const s = spotFor(itemId);
    v = new Vector3(s.x + s.nx * STEM, s.y + s.ny * STEM, s.z + s.nz * STEM);
    anchorsById.set(itemId, v);
  }
  return v;
}

// ---------------------------------------------------------------------------------------------

function glowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uViewportH: { value: 900 }, uSize: { value: 0.95 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aBoost;
      attribute float aPhase;
      uniform float uTime;
      uniform float uViewportH;
      uniform float uSize;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float pulse = 0.85 + 0.15 * sin(uTime * 1.6 + aPhase * 6.2831);
        vColor = aColor;
        vAlpha = (0.75 + 0.5 * aBoost) * pulse;
        gl_PointSize = uSize * (1.0 + 0.7 * aBoost) * uViewportH * 0.5 * projectionMatrix[1][1] / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d) * 2.0;
        float a = exp(-r * r * 5.0) * (1.0 - smoothstep(0.85, 1.0, r));
        gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

/** The 3D pins. Instanced: one draw per part, no per-frame allocation. */
export function LungPins({ animate }: { animate: boolean }) {
  const hits = useLungSafetyHits();
  const show = useLungPins((s) => s.show);
  const hovered = useLungPins((s) => s.hovered);
  const setHovered = useLungPins((s) => s.setHovered);
  const select = useVitra((s) => s.select);
  const selection = useVitra((s) => s.selection);
  const excluded = useVitra((s) => s.excluded);

  const group = useRef<Group>(null);
  const heads = useRef<InstancedMesh>(null);
  const stems = useRef<InstancedMesh>(null);
  const rings = useRef<InstancedMesh>(null);
  const hit = useRef<InstancedMesh>(null);

  const cap = Math.max(1, hits.length);
  const spots = useMemo(() => hits.map((h) => spotFor(h.item.item_id)), [hits]);
  const local = useMemo(() => {
    const a = new Float32Array(cap * 3);
    spots.forEach((s, i) => a.set([s.x + s.nx * STEM, s.y + s.ny * STEM, s.z + s.nz * STEM], i * 3));
    return a;
  }, [spots, cap]);
  const anchors = useMemo(() => hits.map((h) => pinAnchor(h.item.item_id)), [hits]);

  const res = useMemo(() => ({
    head: new IcosahedronGeometry(1, 2),
    stem: new CylinderGeometry(1, 1, 1, 6, 1, true),
    ring: new RingGeometry(0.72, 1, 32),
    headMat: new MeshBasicMaterial({ toneMapped: false }),
    stemMat: new MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.7, depthWrite: false }),
    ringMat: new MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.85, depthWrite: false, side: DoubleSide }),
    hitMat: new MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    glowMat: glowMaterial(),
  }), []);
  useEffect(() => () => { for (const r of Object.values(res)) r.dispose(); }, [res]);

  const glow = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(local, 3));
    g.setAttribute("aColor", new BufferAttribute(new Float32Array(cap * 3), 3).setUsage(DynamicDrawUsage));
    g.setAttribute("aBoost", new BufferAttribute(new Float32Array(cap), 1).setUsage(DynamicDrawUsage));
    const phase = new Float32Array(cap);
    hits.forEach((h, i) => { phase[i] = (h.item.item_id.charCodeAt(h.item.item_id.length - 1) % 10) / 10; });
    g.setAttribute("aPhase", new BufferAttribute(phase, 1));
    g.setDrawRange(0, hits.length);
    g.computeBoundingSphere();
    return g;
  }, [local, cap, hits]);
  useEffect(() => () => glow.dispose(), [glow]);

  const selectedId = selection?.itemId ?? null;

  // Matrices and colors change only when the hits, hover, selection or exclusions change.
  useEffect(() => {
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const n = new Vector3();
    const sc = new Vector3();
    const c = new Color();
    const ex = new Set(excluded);
    const t = theme();
    const colors = glow.attributes.aColor as BufferAttribute;
    const boost = glow.attributes.aBoost as BufferAttribute;
    for (const im of [heads.current, stems.current, rings.current, hit.current]) {
      if (im && !im.instanceColor && im !== hit.current) {
        im.instanceColor = new InstancedBufferAttribute(new Float32Array(im.count * 3), 3);
      }
    }
    hits.forEach((h, i) => {
      const s = spots[i];
      n.set(s.nx, s.ny, s.nz);
      const id = h.item.item_id;
      const focus = id === hovered || id === selectedId;
      const isEx = ex.has(id);
      if (isEx) c.copy(t.muted).multiplyScalar(0.4);
      else polarityColor(h.polarity ?? 0, c);

      p.set(s.x, s.y, s.z).addScaledVector(n, STEM);
      const r = HEAD * (focus ? 1.6 : 1);
      m.compose(p, q.identity(), sc.set(r, r, r));
      heads.current?.setMatrixAt(i, m);
      heads.current?.setColorAt(i, c.clone().multiplyScalar(isEx ? 1 : 1.9));
      hit.current?.setMatrixAt(i, m.compose(p, q, sc.set(HIT, HIT, HIT)));

      q.setFromUnitVectors(Y, n);
      p.set(s.x, s.y, s.z).addScaledVector(n, STEM / 2);
      stems.current?.setMatrixAt(i, m.compose(p, q, sc.set(0.011, STEM, 0.011)));
      stems.current?.setColorAt(i, c);

      q.setFromUnitVectors(Z, n);
      p.set(s.x, s.y, s.z).addScaledVector(n, 0.008);
      const rr = focus ? 0.16 : 0.12;
      rings.current?.setMatrixAt(i, m.compose(p, q, sc.set(rr, rr, rr)));
      rings.current?.setColorAt(i, c.clone().multiplyScalar(1.2));

      colors.setXYZ(i, c.r, c.g, c.b);
      boost.setX(i, isEx ? 0 : focus ? 1 : 0.25);
    });
    for (const im of [heads.current, stems.current, rings.current, hit.current]) {
      if (!im) continue;
      im.count = hits.length;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
    }
    colors.needsUpdate = true;
    boost.needsUpdate = true;
  }, [hits, spots, hovered, selectedId, excluded, glow, show]);

  useFrame((state) => {
    const u = res.glowMat.uniforms;
    if (animate) u.uTime.value = state.clock.elapsedTime;
    u.uViewportH.value = state.size.height * state.viewport.dpr;
    const g = group.current;
    if (!g) return;
    // Keep the DOM anchors on the breathing pins.
    for (let i = 0; i < anchors.length; i++) {
      anchors[i].set(local[i * 3], local[i * 3 + 1], local[i * 3 + 2]).applyMatrix4(g.matrixWorld);
    }
  });

  const idAt = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    e.instanceId !== undefined ? hits[e.instanceId]?.item.item_id ?? null : null;

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const id = idAt(e);
    if (!id) return;
    e.stopPropagation();
    setHovered(id);
    document.body.style.cursor = "pointer";
  };
  const onOut = () => { setHovered(null); document.body.style.cursor = ""; };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const i = e.instanceId;
    if (i === undefined || !hits[i]) return;
    e.stopPropagation();
    const h = hits[i];
    select({ itemId: h.item.item_id, ...(h.aspect ? { aspect: h.aspect } : {}) });
  };

  if (hits.length === 0) return null;
  return (
    <group ref={group} visible={show}>
      <instancedMesh key={`r${cap}`} ref={rings} args={[res.ring, res.ringMat, cap]} renderOrder={5} frustumCulled={false} />
      <instancedMesh key={`s${cap}`} ref={stems} args={[res.stem, res.stemMat, cap]} renderOrder={5} frustumCulled={false} />
      <instancedMesh key={`h${cap}`} ref={heads} args={[res.head, res.headMat, cap]} renderOrder={6} frustumCulled={false} />
      <points geometry={glow} material={res.glowMat} renderOrder={7} frustumCulled={false} />
      {show && (
        <instancedMesh
          key={`x${cap}`}
          ref={hit}
          args={[res.head, res.hitMat, cap]}
          onPointerMove={onMove}
          onPointerOut={onOut}
          onClick={onClick}
        />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// DOM side: keyboard-focusable pins, the hover card and the toggle chip.

export function LungPinLabels() {
  const hits = useLungSafetyHits();
  const show = useLungPins((s) => s.show);
  const setShow = useLungPins((s) => s.setShow);
  const hovered = useLungPins((s) => s.hovered);
  const setHovered = useLungPins((s) => s.setHovered);
  const select = useVitra((s) => s.select);
  const excluded = useVitra((s) => s.excluded);
  const hoverHit = show && hovered ? hits.find((h) => h.item.item_id === hovered) : undefined;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-label="Lung safety evidence">
      {show && hits.map((h) => {
        const id = h.item.item_id;
        const p = h.polarity;
        return (
          <div key={id} ref={anchorRef(`lungpin-${id}`, pinAnchor(id))} className="absolute left-0 top-0 will-change-transform">
            <button
              type="button"
              aria-label={`Lung safety evidence ${id}, ${h.item.iso_week}, ${p === null ? "source text mention, no polarity" : `${POLARITY_WORD[p]} ${signedPolarity(p)}`}. Open the source and see the quote.`}
              onFocus={() => setHovered(id)}
              onBlur={() => setHovered(null)}
              onClick={() => select({ itemId: id, ...(h.aspect ? { aspect: h.aspect } : {}) })}
              className="pointer-events-none block h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 focus-visible:opacity-100"
            />
          </div>
        );
      })}
      {hoverHit && <PinCard key={hoverHit.item.item_id} hit={hoverHit} excluded={excluded.includes(hoverHit.item.item_id)} />}
      <div className="pointer-events-auto absolute bottom-[132px] left-4 z-10 flex flex-col items-start gap-1 max-md:hidden">
        <button
          type="button"
          aria-pressed={show}
          onClick={() => setShow(!show)}
          title={PLACEMENT_NOTE}
          className={`flex items-center gap-2 rounded-full border py-1 pl-2 pr-3 text-[12.5px] backdrop-blur-md transition-colors ${
            show ? "border-magenta/45 bg-bg/80 text-text" : "border-border bg-bg/70 text-text-muted hover:text-text-2"
          }`}
        >
          <span className="relative grid h-3 w-3 place-items-center" aria-hidden>
            <span className={`absolute h-3 w-3 rounded-full ${show ? "bg-magenta/30" : "bg-transparent"}`} />
            <span className={`h-1.5 w-1.5 rounded-full ${show ? "bg-magenta" : "bg-text-muted"}`} />
          </span>
          Lung safety evidence <span className="num text-text-2">({hits.length})</span>
        </button>
        {show && hits.length > 0 && (
          <span className="pl-2 text-[11px] text-text-muted">ILD or pneumonitis in the quote or source. Illustrative placement.</span>
        )}
      </div>
    </div>
  );
}

function PinCard({ hit, excluded }: { hit: LungSafetyHit; excluded: boolean }) {
  const id = hit.item.item_id;
  const { before, term, after } = splitOnTerm(hit.quote);
  const p = hit.polarity;
  return (
    <div ref={anchorRef("lungpin-card", pinAnchor(id))} className="absolute left-0 top-0 z-20 will-change-transform">
      <div role="tooltip" className="ml-4 w-80 -translate-y-1/2 rounded-lg border border-border bg-bg-elevated/95 px-3 py-2.5 shadow-[var(--shadow-panel)] backdrop-blur-md">
        <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="rounded border border-magenta/40 px-1 text-[10.5px] text-magenta">Lung safety</span>
            <span className="num">{id} · {hit.item.iso_week}</span>
          </span>
          <span className="num text-[12px]" style={{ color: polarityCss(p) }}>{p === null ? "no polarity" : signedPolarity(p)}</span>
        </div>
        <p className="mt-1.5 line-clamp-4 text-[13px] leading-snug text-text">
          &ldquo;{before}<mark className="rounded-sm bg-magenta/20 px-0.5 text-text">{term}</mark>{after}&rdquo;
        </p>
        <p className="mt-1.5 text-[11.5px] text-text-2">
          {hit.quoteKind === "span" ? `Verified ${hit.aspect} quote` : "Sentence from the source text"} · {hit.item.source.replace("_", " ")}
          {excluded ? " · excluded" : ""} · click to open
        </p>
        <p className="mt-1 text-[11px] text-text-muted">Illustrative placement. The spot on the lung means nothing anatomically.</p>
      </div>
    </div>
  );
}
