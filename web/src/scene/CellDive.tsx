/**
 * Cell dive: clicking the tumor hotspot opens a short dive (under 2 s, skippable) into a stylized
 * cell surface with EGFR and MET. Its own canvas mounts only while open, so leaving it disposes
 * the whole scene. Reduced motion lands straight on the final view.
 *
 * Integration: render <CellDive animate={animate} /> next to <SceneLabels>, and call
 * useCellDive.getState().openDive({ x: clientX, y: clientY }) (or openDiveFrom(button)) from the tumor.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useVitra } from "../store/useVitra.ts";
import { CellScene } from "./cell/CellScene.tsx";
import { CELL_PRODUCTS, MECHANISMS, MECHANISM_CAPTION, SCENE_LABELS, defaultCellProduct, type CellProduct, type Mechanism } from "./cell/mechanisms.ts";
import { CELL_LABEL_POS, cellAnchor } from "./cell/labels.ts";
import { useCellDive } from "./cell/store.ts";

export { useCellDive, openDiveFrom } from "./cell/store.ts";

const REVEAL_MS = 650;

/** Close the dive and fly the observatory back out to the stations overview. */
export function leaveDive() {
  useCellDive.getState().closeDive();
  const s = useVitra.getState();
  s.setFocusTumor(false);
  s.setFocusStation(null);
}

/** Leave the dive and open the tumor hotspot facts card. */
export function openTumorFacts() {
  useCellDive.getState().closeDive();
  const s = useVitra.getState();
  s.setFocusStation(null);
  s.setFocusTumor(true);
}

export function CellDive({ animate }: { animate: boolean }) {
  const open = useCellDive((s) => s.open);
  return open ? <DiveOverlay animate={animate} /> : null;
}

function DiveOverlay({ animate }: { animate: boolean }) {
  const origin = useCellDive((s) => s.origin);
  const chosen = useCellDive((s) => s.product);
  const arrived = useCellDive((s) => s.arrived);
  const setProduct = useCellDive((s) => s.setProduct);
  const filterProduct = useVitra((s) => s.filters.product);
  const product: CellProduct = chosen ?? defaultCellProduct(filterProduct);
  const m = MECHANISMS[product];

  const root = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const [o, setO] = useState({ x: "50%", y: "50%" });
  const [revealed, setRevealed] = useState(!animate);

  useLayoutEffect(() => {
    const r = root.current?.getBoundingClientRect();
    if (r && origin) setO({ x: `${origin.x - r.left}px`, y: `${origin.y - r.top}px` });
    if (!animate) { useCellDive.getState().setCovering(true); return; }
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setRevealed(true)));
    const t = window.setTimeout(() => useCellDive.getState().setCovering(true), REVEAL_MS);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t); };
  }, [animate, origin]);

  useEffect(() => { if (arrived) back.current?.focus({ preventScroll: true }); }, [arrived]);

  const skip = () => { useCellDive.getState().arrive(); setRevealed(true); useCellDive.getState().setCovering(true); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); leaveDive(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const clip = `circle(${revealed ? "150%" : "0%"} at ${o.x} ${o.y})`;

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Cell view: EGFR and MET"
      className="absolute inset-0 z-30 bg-ink"
      style={{ clipPath: clip, WebkitClipPath: clip, transition: animate ? `clip-path ${REVEAL_MS}ms cubic-bezier(0.7, 0, 0.25, 1)` : undefined }}
      onPointerDown={() => { if (!arrived) skip(); }}
    >
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: "high-performance", alpha: false, stencil: false }}
        camera={{ fov: 38, near: 0.1, far: 80, position: [-7, 15, 30] }}
        aria-label="Stylized cell surface with EGFR and MET receptors"
      >
        <CellScene product={product} animate={animate} />
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.2} intensity={0.7} radius={0.6} />
          <Vignette offset={0.3} darkness={0.7} />
        </EffectComposer>
      </Canvas>

      <div className="pointer-events-none absolute inset-0">
        <SceneTags m={m} />
        <div className="absolute left-5 top-4 max-w-[340px]">
          <p className="text-[11.5px] tracking-[0.04em] text-text-muted">Inside the tumor hotspot</p>
          <h2 className="mt-1 text-[22px] font-medium leading-tight text-text">EGFR and MET on the cell surface</h2>
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-bg/80 px-2 py-1 text-[12px] text-text-2 backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-text-muted" aria-hidden />
            {MECHANISM_CAPTION}
          </p>
        </div>

        <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2">
          <button
            ref={back}
            type="button"
            onClick={leaveDive}
            className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-border bg-bg/80 px-3 py-1.5 text-[13px] text-text-2 backdrop-blur-md hover:border-border-strong hover:text-text"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M7.5 2.5L4 6l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
            Back to the evidence
            <kbd className="num ml-1 rounded border border-border px-1 text-[10.5px] text-text-muted">Esc</kbd>
          </button>
          <button
            type="button"
            onClick={openTumorFacts}
            className="pointer-events-auto rounded-lg border border-border bg-bg/80 px-3 py-1.5 text-[13px] text-text-2 backdrop-blur-md hover:border-border-strong hover:text-text"
          >
            Hotspot facts
          </button>
          {!arrived && (
            <button
              type="button"
              onClick={skip}
              className="pointer-events-auto rounded-lg border border-border bg-bg/80 px-3 py-1.5 text-[13px] text-text-2 backdrop-blur-md hover:text-text"
            >
              Skip
            </button>
          )}
        </div>

        <section aria-label="Mechanism from the label" aria-live="polite" className="panel pointer-events-auto absolute bottom-5 left-5 w-[420px] max-w-[calc(100%-40px)] rounded-xl p-4">
          <div role="group" aria-label="Product" className="flex gap-1 rounded-lg border border-border bg-bg/60 p-0.5">
            {CELL_PRODUCTS.map((p) => {
              const on = p === product;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setProduct(p)}
                  className={`flex-1 rounded-md px-2 py-1 text-[12.5px] transition-colors ${on ? "bg-accent-soft text-text" : "text-text-muted hover:text-text-2"}`}
                >
                  {MECHANISMS[p].brand}
                  <span className="block text-[11px] text-text-muted">{MECHANISMS[p].drug}</span>
                </button>
              );
            })}
          </div>
          <ul className="mt-3 space-y-2.5">
            {m.captions.map((c) => (
              <li key={c.id} className="text-[13.5px] leading-snug text-text">
                {c.text}
                <span className="mt-0.5 block text-[11.5px] text-text-muted">{c.source}. Checked {c.checked}.</span>
              </li>
            ))}
          </ul>
          {m.antibody === "none" && (
            <p className="mt-2.5 border-t border-border pt-2.5 text-[12px] leading-snug text-text-2">
              No drug is drawn on the receptors here. The Tagrisso label names the target, not the binding site.
            </p>
          )}
          {product === "lazcluze" && (
            <p className="mt-2.5 border-t border-border pt-2.5 text-[12px] leading-snug text-text-2">
              Amivantamab is drawn faintly because Lazcluze is given with it. Lazertinib itself is a label callout.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/** Names on the receptors and the antibody, plus the label-only callout for kinase inhibitors. */
function SceneTags({ m }: { m: Mechanism }) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={cellAnchor("egfr", CELL_LABEL_POS.egfr)} className="absolute left-0 top-0 will-change-transform">
        <div className="relative -translate-x-full -translate-y-1/2">
          <span className="whitespace-nowrap rounded-md border border-ivory/50 bg-bg/80 px-2 py-0.5 text-[12.5px] font-medium text-ivory backdrop-blur-sm">{SCENE_LABELS.egfr}</span>
          {m.callout && (
            <div className="absolute bottom-8 right-0 w-60 rounded-lg border border-border-strong bg-bg-elevated/90 px-3 py-2 text-left backdrop-blur-md">
              <div className="flex items-center gap-1.5 text-[12.5px] text-text">
                <span className="h-1.5 w-1.5 rounded-full bg-text-muted" aria-hidden />
                {m.callout.drug}
                <span className="text-[11px] text-text-muted">label callout</span>
              </div>
              <p className="mt-1 text-[11.5px] leading-snug text-text-2">{m.callout.role} {m.callout.note}</p>
            </div>
          )}
        </div>
      </div>
      <div ref={cellAnchor("met", CELL_LABEL_POS.met)} className="absolute left-0 top-0 will-change-transform">
        <span className="block -translate-y-1/2 whitespace-nowrap rounded-md border border-muted/50 bg-bg/80 px-2 py-0.5 text-[12.5px] font-medium text-muted backdrop-blur-sm">{SCENE_LABELS.met}</span>
      </div>
      <div ref={cellAnchor("side", CELL_LABEL_POS.side)} className="absolute left-0 top-0 will-change-transform">
        <span className="block whitespace-nowrap text-[11.5px] tracking-[0.04em] text-text-muted">{SCENE_LABELS.side}</span>
      </div>
      {m.antibody === "bound" && (
        <div ref={cellAnchor("antibody", CELL_LABEL_POS.antibody)} className="absolute left-0 top-0 will-change-transform">
          <span className={`block -translate-y-1/2 whitespace-nowrap rounded-full border border-blue/45 bg-bg/75 px-2 py-0.5 text-[12px] text-blue backdrop-blur-sm ${m.id === "rybrevant" ? "" : "opacity-60"}`}>
            {SCENE_LABELS.antibody}
          </span>
        </div>
      )}
    </div>
  );
}
