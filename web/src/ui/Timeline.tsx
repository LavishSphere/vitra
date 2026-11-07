import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { matchesAspect, matchesItem, useVitra } from "../store/useVitra.ts";
import { shortWeek, weekMonthLabel } from "../lib/isoWeek.ts";

/** ISO-week range scrubber with a histogram of matching quotes per week. */
export function Timeline() {
  const weeks = useVitra((s) => s.weeks);
  const evidence = useVitra((s) => s.evidence);
  const excluded = useVitra((s) => s.excluded);
  const f = useVitra((s) => s.filters);
  const setWeekRange = useVitra((s) => s.setWeekRange);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<"from" | "to" | null>(null);

  const i0 = Math.max(0, weeks.indexOf(f.weekFrom));
  const i1 = Math.max(0, weeks.indexOf(f.weekTo));

  // Counts ignore the week range itself so the histogram shows what the scrubber can reach.
  const counts = useMemo(() => {
    const noRange = { ...f, weekFrom: "", weekTo: "" };
    const ex = new Set(excluded);
    const idx = new Map(weeks.map((w, i) => [w, i]));
    const c = new Array<number>(weeks.length).fill(0);
    for (const it of evidence) {
      if (ex.has(it.item_id) || !matchesItem(it, noRange)) continue;
      if (!it.aspects.some((a) => matchesAspect(a, noRange))) continue;
      const i = idx.get(it.iso_week);
      if (i !== undefined) c[i]++;
    }
    return c;
  }, [evidence, excluded, f, weeks]);
  const max = Math.max(1, ...counts);
  const inRange = counts.slice(i0, i1 + 1).reduce((a, b) => a + b, 0);

  const n = weeks.length;
  const sameYear = weeks[i0]?.slice(0, 4) === weeks[i1]?.slice(0, 4);
  const tickStep = Math.max(2, Math.ceil(n / 12 / 2) * 2);
  const pct = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);

  const indexAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.round(t * (n - 1));
  };
  const apply = (which: "from" | "to", i: number) => {
    if (which === "from") setWeekRange(weeks[Math.min(i, i1)], weeks[i1]);
    else setWeekRange(weeks[i0], weeks[Math.max(i, i0)]);
  };
  const onDown = (e: PointerEvent) => {
    if (!n) return;
    const i = indexAt(e.clientX);
    const which = Math.abs(i - i0) <= Math.abs(i - i1) && !(i > i1) ? "from" : "to";
    dragging.current = which;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    apply(which, i);
  };
  const onMove = (e: PointerEvent) => { if (dragging.current) apply(dragging.current, indexAt(e.clientX)); };
  const onUp = () => { dragging.current = null; };

  const onKey = (which: "from" | "to") => (e: KeyboardEvent) => {
    const cur = which === "from" ? i0 : i1;
    let next = cur;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = cur - 1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = cur + 1;
    else if (e.key === "PageDown") next = cur - 4;
    else if (e.key === "PageUp") next = cur + 4;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else return;
    e.preventDefault();
    apply(which, Math.max(0, Math.min(n - 1, next)));
  };

  if (!n) return null;

  return (
    <section aria-label="Week range" className="pointer-events-auto px-5 pb-3 pt-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-text-2">
          <span className="num text-text">{shortWeek(weeks[i0])}</span>
          <span className="text-text-muted"> {weekMonthLabel(weeks[i0])}{sameYear ? "" : `, ${weeks[i0].slice(0, 4)}`}</span>
          <span className="text-text-muted"> to </span>
          <span className="num text-text">{shortWeek(weeks[i1])}</span>
          <span className="text-text-muted"> {weekMonthLabel(weeks[i1])}, {weeks[i1].slice(0, 4)}</span>
        </span>
        <span className="num text-text-muted">{i1 - i0 + 1} weeks · {inRange} items with quotes</span>
      </div>
      <div
        ref={track}
        className="relative h-11 cursor-ew-resize touch-none select-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="absolute inset-x-0 bottom-3 top-0 flex items-end gap-[2px]" aria-hidden>
          {counts.map((c, i) => (
            <div key={weeks[i]} className="relative flex-1">
              <div
                className={`w-full rounded-t-[2px] transition-colors ${i >= i0 && i <= i1 ? "bg-text-2/70" : "bg-text-muted/25"}`}
                style={{ height: c ? `${4 + (c / max) * 24}px` : "1px", opacity: c ? 1 : 0.6 }}
              />
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-[11px] h-px bg-border" />
        <div className="absolute bottom-[10px] h-[3px] rounded-full bg-accent" style={{ left: `${pct(i0)}%`, width: `${pct(i1) - pct(i0)}%` }} />
        {(["from", "to"] as const).map((which) => {
          const i = which === "from" ? i0 : i1;
          return (
            <button
              key={which}
              type="button"
              role="slider"
              aria-label={which === "from" ? "First week" : "Last week"}
              aria-valuemin={0}
              aria-valuemax={n - 1}
              aria-valuenow={i}
              aria-valuetext={`${weeks[i]}, week of ${weekMonthLabel(weeks[i])}`}
              onKeyDown={onKey(which)}
              onPointerDown={(e) => { e.stopPropagation(); dragging.current = which; track.current?.setPointerCapture(e.pointerId); }}
              className="absolute bottom-[4px] h-4 w-4 -translate-x-1/2 rounded-full border-2 border-accent bg-bg shadow-[0_0_0_4px_rgb(10_14_23/0.8)] transition-transform hover:scale-110"
              style={{ left: `${pct(i)}%` }}
            />
          );
        })}
        <div className="num pointer-events-none absolute inset-x-0 -bottom-1.5 h-3 text-[10px] text-text-muted" aria-hidden>
          {weeks.map((w, i) => (i % tickStep === 0 ? (
            <span key={w} className={`absolute whitespace-nowrap ${i === 0 ? "" : "-translate-x-1/2"}`} style={{ left: `${pct(i)}%` }}>{w.endsWith("W01") ? w.slice(0, 4) : shortWeek(w)}</span>
          ) : null))}
        </div>
      </div>
    </section>
  );
}
