/**
 * Floating quote panel for the evidence dive. DOM, pinned next to the dived point in the scene
 * (the label projector moves it every frame without React re-rendering).
 * It shows the exact quote only when the span verifies against the source text.
 * Keys: Tab or arrows walk the evidence, Enter opens the X-Ray, Esc leaves the dive.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { EvidenceItem } from "@contract/types.ts";
import { useVitra, type Mark } from "../store/useVitra.ts";
import { dataSource } from "../data/index.ts";
import { spanIsVerified } from "../data/spans.ts";
import { STATIONS, STATION_INDEX } from "../data/stations.ts";
import { anchorRef } from "../scene/labels.ts";
import { diveAnchor } from "../scene/EvidenceDive.tsx";
import { diveKey, diveOrder, stepDive, type DiveTarget } from "../scene/diveMath.ts";
import { ASPECT_LABEL, PRODUCT_LABEL, SOURCE_LABEL, SPEAKER_LABEL } from "./options.ts";
import { OriginBadge } from "./controls.tsx";
import { POLARITY_WORD, signedPolarity } from "../lib/format.ts";
import { polarityCss } from "../theme.ts";

export interface EvidencePanelProps {
  target: DiveTarget | null;
  /** Dive to another point (Tab, arrows, or the next/previous buttons). */
  onStep: (next: DiveTarget) => void;
  /** Leave the dive (Esc or the close button). */
  onExit: () => void;
  /** Open the full source in the Evidence X-Ray. */
  onOpenXRay: (t: DiveTarget) => void;
}

type QuoteState = { status: "ok"; text: string } | { status: "checking" } | { status: "unverified" };

/** The quote is shown only if it sits at its offsets in the source. List text can be truncated, so fetch the full item when needed. */
function useVerifiedQuote(item: EvidenceItem | undefined, aspect: Mark["aspect"] | undefined): QuoteState {
  const [full, setFull] = useState<{ id: string; text: string } | null>(null);
  const localOk = !!item && !!aspect && spanIsVerified(item.text, aspect);
  const needFetch = !!item && !!aspect && !localOk && item.text.length < aspect.span_end;
  useEffect(() => {
    if (!needFetch || !item) return;
    let live = true;
    void dataSource.item(item.item_id).then((it) => { if (live && it) setFull({ id: it.item_id, text: it.text }); });
    return () => { live = false; };
  }, [needFetch, item]);
  if (!item || !aspect) return { status: "unverified" };
  if (localOk) return { status: "ok", text: aspect.span };
  if (full && full.id === item.item_id) return spanIsVerified(full.text, aspect) ? { status: "ok", text: aspect.span } : { status: "unverified" };
  return needFetch ? { status: "checking" } : { status: "unverified" };
}

export function EvidencePanel({ target, onStep, onExit, onOpenXRay }: EvidencePanelProps) {
  const marks = useVitra((s) => s.marks);
  const xrayOpen = useVitra((s) => s.selection !== null);
  const intakeOpen = useVitra((s) => s.intakeOpen);
  const key = target ? diveKey(target) : null;
  const mark = useMemo(() => (key ? marks.find((m) => m.key === key) : undefined), [marks, key]);
  const order = useMemo(() => diveOrder(marks), [marks]);
  const pos = mark ? order.findIndex((m) => m.key === mark.key) : -1;
  const card = useRef<HTMLDivElement>(null);
  const quote = useVerifiedQuote(mark?.item, mark?.aspect);
  const active = !!mark && mark.visible;
  // Fade the card in on each new point (instant when motion is reduced, via motion-reduce).
  const [shownKey, setShownKey] = useState<string | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShownKey(key));
    return () => cancelAnimationFrame(id);
  }, [key]);
  const shown = shownKey === key;

  // Keep callbacks fresh for the key handler without re-binding it.
  const cb = useRef({ onStep, onExit, onOpenXRay, order, key, active, blocked: xrayOpen || intakeOpen });
  cb.current = { onStep, onExit, onOpenXRay, order, key, active, blocked: xrayOpen || intakeOpen };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = cb.current;
      if (!c.active || c.blocked || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [role=listbox], [role=slider], [role=radiogroup]")) return;
      let dir: 1 | -1 | 0 = 0;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") dir = 1;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") dir = -1;
      else if (e.key === "Tab") dir = e.shiftKey ? -1 : 1;
      if (dir) {
        e.preventDefault();
        const next = stepDive(c.order, c.key, dir);
        if (next) c.onStep({ itemId: next.item.item_id, aspect: next.aspect.aspect });
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); c.onExit(); return; }
      if (e.key === "Enter" && !t?.closest("button, a")) {
        e.preventDefault();
        const [itemId, aspect] = (c.key ?? "").split(":");
        if (itemId && aspect) c.onOpenXRay({ itemId, aspect } as DiveTarget);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Move focus into the card on each new point so screen readers announce the quote.
  useEffect(() => {
    if (active && !xrayOpen) card.current?.focus({ preventScroll: true });
  }, [active, key, xrayOpen]);

  if (!active || !mark) return null;
  const { item, aspect: a } = mark;
  const station = STATIONS[STATION_INDEX[mark.station]];
  const color = polarityCss(a.polarity);
  const step = (dir: 1 | -1) => {
    const next = stepDive(order, mark.key, dir);
    if (next) onStep({ itemId: next.item.item_id, aspect: next.aspect.aspect });
  };

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-label="Evidence dive">
      <div ref={anchorRef("dive-panel", diveAnchor)} className="absolute left-0 top-0 will-change-transform">
        <div className="flex -translate-y-1/2 items-center">
          <span aria-hidden className="h-px w-7 shrink-0 bg-gradient-to-r from-transparent to-border-strong" />
          <div
            ref={card}
            key={mark.key}
            tabIndex={-1}
            style={{ outline: "none" }}
            role="dialog"
            aria-label={`Quote ${pos + 1} of ${order.length}, ${station.label}`}
            className={`pointer-events-auto w-[372px] max-w-[calc(100vw-48px)] rounded-xl border border-border bg-bg-elevated/90 shadow-[var(--shadow-panel)] backdrop-blur-xl outline-none transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-accent/60 ${shown ? "translate-x-0 opacity-100" : "translate-x-2 opacity-0"}`}
          >
            <header className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
              <span className="num rounded border border-accent/40 bg-accent-soft px-1.5 text-[11px] text-text">{STATION_INDEX[mark.station] + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-2">{station.label}</span>
              <span className="num text-[11px] text-text-muted">{pos + 1} / {order.length}</span>
              <button
                type="button"
                onClick={onExit}
                aria-label="Leave the dive"
                className="ml-1 flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-text-muted hover:border-border-strong hover:text-text"
              >
                <kbd className="num">Esc</kbd>
              </button>
            </header>

            <div className="px-4 pb-3 pt-3.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{ASPECT_LABEL[a.aspect]}</span>
                {mark.excluded && <span className="rounded border border-dashed border-border-strong px-1 text-[10.5px] text-text-muted">excluded</span>}
              </div>
              <blockquote className="relative border-l-2 pl-3 text-[15.5px] leading-[1.55] text-text" style={{ borderColor: color }}>
                {quote.status === "ok" && <>&ldquo;{quote.text}&rdquo;</>}
                {quote.status === "checking" && <span className="text-text-muted">Checking the quote against the source text</span>}
                {quote.status === "unverified" && <span className="text-text-muted">This quote did not match its source text, so it is not shown.</span>}
              </blockquote>

              <dl className="mt-3.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
                <dt className="text-text-muted">Sentiment</dt>
                <dd className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} aria-hidden />
                  <span className="num" style={{ color }}>{signedPolarity(a.polarity)}</span>
                  <span className="text-text-2">{POLARITY_WORD[a.polarity]}</span>
                </dd>
                <dt className="text-text-muted">Speaker</dt>
                <dd className="text-text-2">{SPEAKER_LABEL[a.speaker]}</dd>
                <dt className="text-text-muted">Source</dt>
                <dd className="min-w-0 text-text-2">
                  <span>{SOURCE_LABEL[item.source]}</span>
                  <span className="block truncate text-[11.5px] text-text-muted" title={item.title}>{item.title}</span>
                </dd>
                <dt className="text-text-muted">Date</dt>
                <dd className="num text-text-2">{item.published} <span className="text-text-muted">· {item.iso_week}</span></dd>
                <dt className="text-text-muted">Item</dt>
                <dd className="flex flex-wrap items-center gap-2 text-text-2">
                  <span className="num text-[12px]">{item.item_id}</span>
                  <span className="text-text-muted">{PRODUCT_LABEL[item.product]}</span>
                  <OriginBadge origin={item.origin} />
                </dd>
              </dl>
            </div>

            <footer className="flex items-center gap-2 border-t border-border/70 px-3 py-2.5">
              <button
                type="button"
                onClick={() => onOpenXRay({ itemId: item.item_id, aspect: a.aspect })}
                className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-bg transition-colors hover:bg-accent-hover"
              >
                Open in X-Ray
              </button>
              <div className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => step(-1)} aria-label="Previous quote" className="rounded-md border border-border px-2 py-1 text-[12px] text-text-2 hover:border-border-strong hover:text-text">
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M7.5 2.5L4 6l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
                </button>
                <button type="button" onClick={() => step(1)} aria-label="Next quote" className="rounded-md border border-border px-2 py-1 text-[12px] text-text-2 hover:border-border-strong hover:text-text">
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
                </button>
              </div>
            </footer>
            <p className="px-4 pb-2.5 text-[11px] text-text-muted">
              <kbd className="num">Tab</kbd> or arrows for the next quote · <kbd className="num">Enter</kbd> X-Ray · <kbd className="num">Esc</kbd> back
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
