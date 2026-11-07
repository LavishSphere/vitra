/**
 * Spectral lens controls and readouts (DOM, so they are focusable and readable).
 * The chips write the store's aspect filter, so the top bar Aspect menu, the ring and the
 * scene stay in step. Every number is from lensSummary (computeSummary underneath).
 */
import { useMemo, useRef, type KeyboardEvent } from "react";
import { ASPECTS, type AspectKey } from "@contract/types.ts";
import { useVitra } from "../store/useVitra.ts";
import { lensSummary, sliceReadout, type LensFocus } from "../data/lens.ts";
import { anchorRef } from "../scene/labels.ts";
import { RING_FRONT_ANCHOR } from "../scene/SpectralRing.tsx";
import { ASPECT_LABEL } from "./options.ts";
import { polarityCss } from "../theme.ts";

const FOCI: LensFocus[] = ["all", ...ASPECTS];
const label = (f: LensFocus) => (f === "all" ? "All aspects" : ASPECT_LABEL[f]);

function useLens() {
  const evidence = useVitra((s) => s.evidence);
  const excluded = useVitra((s) => s.excluded);
  const filters = useVitra((s) => s.filters);
  return useMemo(() => lensSummary(evidence, excluded, filters), [evidence, excluded, filters]);
}

/** A row of lens chips. Arrow keys move the lens; each chip shows mean and N. */
export function LensBar({ className = "" }: { className?: string }) {
  const summary = useLens();
  const setFilter = useVitra((s) => s.setFilter);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const choose = (f: LensFocus) => setFilter("aspect", f);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const i = (FOCI.indexOf(summary.focus) + step + FOCI.length) % FOCI.length;
    choose(FOCI[i]);
    refs.current[i]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Spectral lens: pick an aspect"
      onKeyDown={onKey}
      className={`pointer-events-auto flex w-[236px] flex-col gap-0.5 rounded-xl border border-border bg-bg/75 p-1.5 backdrop-blur-md ${className}`}
    >
      <div className="flex items-baseline justify-between px-2 pb-1 pt-0.5">
        <span className="select-none text-[11px] uppercase tracking-[0.14em] text-text-muted">Spectral lens</span>
        <span className="num text-[10.5px] text-text-muted">mean · N</span>
      </div>
      {FOCI.map((f, i) => {
        const on = summary.focus === f;
        const agg = f === "all" ? summary.pooled : summary.slices.find((s) => s.aspect === f)!;
        const r = sliceReadout(agg);
        const empty = agg.mean_polarity === null;
        const color = polarityCss(agg.mean_polarity);
        return (
          <button
            key={f}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => choose(f)}
            title={empty ? `${label(f)}: no evidence for these filters` : `${label(f)}: mean polarity ${r.mean}, ${r.count}`}
            className={`flex items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors ${
              on ? "bg-accent-soft shadow-[inset_0_0_0_1px_rgb(129_140_248/0.45)]" : "hover:bg-bg-hover"
            }`}
          >
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${empty ? "border border-dashed border-text-muted" : ""}`}
              style={empty ? undefined : { background: color, boxShadow: on ? `0 0 10px ${color}` : undefined }}
            />
            <span className={`min-w-0 flex-1 truncate text-[12.5px] ${on ? "text-text" : "text-text-2"}`}>{label(f)}</span>
            <span className="num whitespace-nowrap text-[11.5px] text-text-muted">
              {empty ? "no evidence" : <><span style={{ color }}>{r.mean}</span> · {agg.n_items}</>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The readout pinned under the front of the ring: the focused aspect's mean and counts. */
export function RingReadout({ hidden = false }: { hidden?: boolean }) {
  const summary = useLens();
  const f = summary.focus;
  const agg = summary.overall;
  const r = sliceReadout(agg);
  const empty = agg.mean_polarity === null;
  return (
    <div ref={anchorRef("lens-ring", RING_FRONT_ANCHOR)} className="pointer-events-none absolute left-0 top-0 will-change-transform">
      <div
        role="status"
        aria-live="polite"
        className={`-translate-x-1/2 whitespace-nowrap rounded-full border border-border/80 bg-bg/70 px-3 py-1 text-[12px] backdrop-blur-md transition-opacity duration-300 ${hidden ? "opacity-0" : "opacity-100"}`}
      >
        <span className="text-text-muted">{f === "all" ? "All aspects" : ASPECT_LABEL[f as AspectKey]}</span>
        <span className="num ml-2" style={{ color: polarityCss(agg.mean_polarity) }}>{empty ? "no evidence" : r.mean}</span>
        <span className="num ml-2 text-text-muted">{empty ? "N 0" : r.count}</span>
      </div>
    </div>
  );
}
