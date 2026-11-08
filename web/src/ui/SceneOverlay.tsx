import { useEffect, useState } from "react";
import { useVitra } from "../store/useVitra.ts";
import { missingCellMessage } from "../lib/gapFocus.ts";
import { MECHANISM_CAPTION, verifiedFacts } from "../data/biomedical.ts";
import { STATIONS } from "../data/stations.ts";
import { useArrival } from "../scene/arrival.ts";
import { openDiveFrom } from "../scene/cell/store.ts";
import { GuidedExperience } from "./GuidedExperience.tsx";

export function SceneOverlay({ is3d }: { is3d: boolean }) {
  const focusStation = useVitra((s) => s.focusStation);
  const focusTumor = useVitra((s) => s.focusTumor);
  const tumorCardOpen = useVitra((s) => s.tumorCardOpen);
  const clearFocus = useVitra((s) => s.clearFocus);
  const setTumorCardOpen = useVitra((s) => s.setTumorCardOpen);
  const focused = focusStation !== null || focusTumor;
  const station = STATIONS.find((s) => s.id === focusStation);
  // The 2D view has no arrival: it is the readable view, so show the full chrome at once.
  useEffect(() => { if (!is3d) useArrival.getState().engage(); }, [is3d]);

  return (
    <>
      <div className="pointer-events-none absolute left-1/2 top-4 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5">
        {is3d && focused && (
          <button
            type="button"
            onClick={() => clearFocus()}
            className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-border bg-bg/80 px-2.5 py-1 text-[13px] text-text-2 backdrop-blur-md hover:border-border-strong hover:text-text"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M7.5 2.5L4 6l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
            Back to overview
            <kbd className="num ml-1 rounded border border-border px-1 text-[10.5px] text-text-muted">0</kbd>
          </button>
        )}
        {is3d && station && <span className="rounded-md bg-bg/70 px-2 py-0.5 text-[13px] text-text-2 backdrop-blur-md">{station.rule}</span>}
        <MissingCellNote />
      </div>
      {tumorCardOpen && <TumorCard onClose={() => setTumorCardOpen(false)} />}
      {focusTumor && !tumorCardOpen && (
        <button
          type="button"
          onClick={() => setTumorCardOpen(true)}
          className="pointer-events-auto absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-full border border-border bg-bg/70 py-1 pl-2 pr-2.5 text-[12px] text-text-2 backdrop-blur-md hover:border-border-strong hover:text-text"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-magenta" aria-hidden />
          Tumor facts
        </button>
      )}
      <Legend is3d={is3d} />
      {is3d && <FirstHint />}
      {is3d && <GuidedExperience />}
      {is3d && <SkipArrival />}
      {is3d && !focusTumor && (
        <p className="pointer-events-none absolute right-4 top-5 text-[11.5px] text-text-muted max-md:hidden">
          Illustrative anatomy. Not to scale.
        </p>
      )}
    </>
  );
}

/** An empty focused cell is missing evidence. A blank scene is that absence. */
function MissingCellNote() {
  const speaker = useVitra((s) => s.filters.speaker);
  const aspect = useVitra((s) => s.filters.aspect);
  const visible = useVitra((s) => s.marks.reduce((n, m) => n + (m.visible && !m.excluded ? 1 : 0), 0));
  const msg = missingCellMessage(visible, { speaker, aspect });
  if (!msg) return null;
  return (
    <p role="status" className="pointer-events-none max-w-md rounded-lg border border-border bg-bg/85 px-3 py-1.5 text-center text-[12.5px] leading-snug text-text-2 backdrop-blur-md">
      {msg}
    </p>
  );
}

/** A visible way out of the arrival move. Any key, click or scroll also skips it. */
function SkipArrival() {
  const arriving = useArrival((s) => s.arriving);
  if (!arriving) return null;
  return (
    <button
      type="button"
      onClick={() => useArrival.getState().skip()}
      className="pointer-events-auto absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-bg/70 px-3 py-1 text-[12.5px] text-text-2 backdrop-blur-md transition-colors hover:border-border-strong hover:text-text"
    >
      Skip intro
      <span className="text-text-muted">any key</span>
    </button>
  );
}

const HINT_MS = 7000;

/**
 * One short hint, shown once after the arrival move. Hides itself after a few seconds or on
 * the first drag, click or key press. The full key lives behind "How to read this".
 */
function FirstHint() {
  const arriving = useArrival((s) => s.arriving);
  const [show, setShow] = useState(true);
  const touched = useVitra((s) => s.selection !== null || s.focusStation !== null || s.focusTumor);
  useEffect(() => {
    if (!show || arriving) return;
    const off = () => setShow(false);
    const timer = window.setTimeout(off, HINT_MS);
    window.addEventListener("pointerdown", off, { once: true });
    window.addEventListener("keydown", off, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", off);
      window.removeEventListener("keydown", off);
    };
  }, [show, arriving]);
  if (!show || touched || arriving) return null;
  return (
    <p className="hint-in pointer-events-none absolute inset-x-0 top-4 mx-auto w-fit max-w-[92%] rounded-full border border-border bg-bg/70 px-3.5 py-1.5 text-center text-[12.5px] text-text-2 backdrop-blur-md max-md:hidden">
      Each dot is one quote. Click a station to travel there, or a dot to read its source.
      <span className="text-text-muted"> Keys 1 to 5 visit, 0 comes back.</span>
    </p>
  );
}

function TumorCard({ onClose }: { onClose: () => void }) {
  const product = useVitra((s) => s.filters.product);
  const facts = verifiedFacts(product);
  return (
    <section aria-label="Tumor hotspot" className="panel scroll-thin pointer-events-auto absolute right-4 top-4 z-20 max-h-[min(420px,calc(100%-160px))] w-[280px] overflow-y-auto rounded-xl p-3.5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-medium text-text">Tumor hotspot</h2>
        <button type="button" onClick={onClose} className="text-[12.5px] text-accent hover:text-accent-hover">Close</button>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-text-2">
        Illustrative anatomy. The glow marks where a tumor sits in this stylized lung. It never changes with the evidence, because sentiment says nothing about biology.
      </p>
      <button
        type="button"
        onClick={(e) => openDiveFrom(e.currentTarget)}
        className="mt-3 w-full rounded-lg border border-border bg-bg/60 px-3 py-2 text-[13px] text-text-2 hover:border-border-strong hover:text-text"
      >
        See receptors
      </button>
      <h3 className="mt-3 border-t border-border pt-3 text-[13px] text-text">From the labels</h3>
      <ul className="mt-1.5 space-y-2 text-[12.5px] leading-relaxed text-text-2">
        {facts.map((f) => (
          <li key={f.id}>
            {f.text}
            <span className="block text-[11.5px] text-text-muted">{f.source}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px] text-text-muted">{MECHANISM_CAPTION}</p>
    </section>
  );
}

function Legend({ is3d }: { is3d: boolean }) {
  // Folded to a button so the first look belongs to the scene. The 2D view opens it.
  const [open, setOpen] = useState(!is3d);
  const focused = useVitra((s) => s.focusStation !== null || s.focusTumor);
  // Collapse once when you fly into a station or the tumor so the view stays clear.
  // Clicking the chip must still reopen it (the old `open && !focused` gate ignored that click).
  useEffect(() => {
    if (is3d && focused) setOpen(false);
  }, [is3d, focused]);
  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-10 max-md:hidden">
      {open ? (
        <section aria-label="How to read the scene" className="panel w-[284px] rounded-xl px-4 py-3 text-[12px] leading-relaxed text-text-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] text-text">How to read this</h2>
            <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-accent hover:text-accent-hover">Hide</button>
          </div>
          <div className="mb-1 h-1.5 rounded-full" style={{ background: "linear-gradient(90deg, var(--color-magenta), var(--color-muted), var(--color-cyan))" }} aria-hidden />
          <div className="num mb-2 flex justify-between text-[11px] text-text-muted"><span>{"−"}2 negative</span><span>0</span><span>+2 positive</span></div>
          <p>Each dot is one quote from a source. Click empty chart glass to focus that station. Height is polarity; earlier weeks sit on the left.</p>
          {is3d && <p className="mt-1.5">The points moving through the airways show airflow, timed to each breath.</p>}
          {is3d && <p className="mt-1.5">The path on the floor joins the five stations in treatment order. Click one to travel there.</p>}
          <p className="mt-1.5 text-text-muted">Illustrative anatomy. Not to scale.</p>
        </section>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-full border border-border bg-bg/60 py-1 pl-1.5 pr-2.5 text-[12px] text-text-2 backdrop-blur-md transition-colors hover:border-border-strong hover:text-text">
          <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full border border-border-strong text-[10px] text-text-muted">?</span>
          How to read this
        </button>
      )}
    </div>
  );
}
