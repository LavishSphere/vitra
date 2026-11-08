import { useState } from "react";
import type { Speaker, TrendCell } from "@contract/types.ts";
import { speakerVar } from "../theme.ts";
import { shortWeek } from "../lib/isoWeek.ts";
import { signedPolarity } from "../lib/format.ts";
import { SPEAKER_LABEL } from "./options.ts";

interface Props {
  title: string;
  cells: TrendCell[]; // one product + one aspect, many speakers, already week-filtered
  weeks: string[];
  speakers: Speaker[];
  onOpen: (itemId: string) => void;
  compact?: boolean;
  /** Shown only on narrow screens, where the product column headers are hidden. */
  subtitle?: string;
}

const H = 112;
const PAD = { l: 26, r: 8, t: 8, b: 18 };

/**
 * Mean polarity per speaker over time. Up to 16 steps (10 compact); a longer range folds
 * neighboring weeks into one step, weighted by item count. Lines join only consecutive
 * steps that both have data; an empty step is a break in the line, never a zero.
 */
/** Most time steps a chart draws; longer ranges fold neighboring weeks together. */
const MAX_STEPS = 16;
const MAX_STEPS_COMPACT = 10;

interface Point { i: number; mean: number; n: number; ids: string[]; }

export function TrendChart({ title, cells, weeks, speakers, onOpen, compact, subtitle }: Props) {
  const [hoverStep, setHoverStep] = useState<number | null>(null);
  const W = compact ? 176 : 360;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const steps = Math.max(1, Math.min(weeks.length, compact ? MAX_STEPS_COMPACT : MAX_STEPS));
  const stepOf = (weekIndex: number) => (weeks.length <= 1 ? 0 : Math.min(steps - 1, Math.floor((weekIndex * steps) / weeks.length)));
  const stepWeeks = (k: number) => {
    const first = Math.ceil((k * weeks.length) / steps);
    const last = Math.ceil(((k + 1) * weeks.length) / steps) - 1;
    return [weeks[first], weeks[Math.max(first, last)]] as const;
  };
  const x = (k: number) => PAD.l + (steps <= 1 ? iw / 2 : (k / (steps - 1)) * iw);
  const y = (p: number) => PAD.t + ((2 - p) / 4) * ih;

  const series = (() => {
    const byWeek = new Map(weeks.map((w, i) => [w, i]));
    return speakers.map((sp) => {
      const acc = new Map<number, { sum: number; n: number; ids: string[] }>();
      for (const c of cells) {
        if (c.speaker !== sp || c.mean_polarity === null) continue;
        const wi = byWeek.get(c.week);
        if (wi === undefined) continue;
        const k = stepOf(wi);
        const a = acc.get(k) ?? { sum: 0, n: 0, ids: [] };
        a.sum += c.mean_polarity * c.n_items;
        a.n += c.n_items;
        a.ids.push(...c.item_ids);
        acc.set(k, a);
      }
      const pts: Point[] = [...acc.entries()]
        .map(([i, a]) => ({ i, mean: a.n ? a.sum / a.n : 0, n: a.n, ids: a.ids }))
        .sort((a, b) => a.i - b.i);
      const segs: string[] = [];
      for (let k = 1; k < pts.length; k++) {
        if (pts[k].i === pts[k - 1].i + 1) segs.push(`M${x(pts[k - 1].i)},${y(pts[k - 1].mean)}L${x(pts[k].i)},${y(pts[k].mean)}`);
      }
      return { sp, pts, d: segs.join("") };
    }).filter((s) => s.pts.length > 0);
  })();

  const totalIds = new Set<string>();
  for (const s of series) for (const p of s.pts) for (const id of p.ids) totalIds.add(id);
  const totals = totalIds.size;

  const hoverCells = hoverStep === null ? [] : series.flatMap((s) => s.pts.filter((p) => p.i === hoverStep).map((p) => ({ sp: s.sp, p })));
  const rangeLabel = (k: number) => {
    const [a, b] = stepWeeks(k);
    return a === b ? a : `${a} to ${b}`;
  };

  return (
    <figure className="relative m-0">
      <figcaption className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-text">{title}{subtitle && <span className="text-text-muted sm:hidden"> · {subtitle}</span>}</span>
        <span className="num text-[11px] text-text-muted">N = {totals}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ aspectRatio: `${W} / ${H}` }}
        className="block h-auto w-full overflow-visible"
        role="img"
        aria-label={`${title}: weekly mean polarity by speaker, ${totals} items`}
        onMouseLeave={() => setHoverStep(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          if (r.width <= 0) return;
          const px = ((e.clientX - r.left) / r.width) * W;
          const k = Math.round(((px - PAD.l) / iw) * (steps - 1));
          setHoverStep(k >= 0 && k < steps ? k : null);
        }}
      >
        {[2, 1, 0, -1, -2].map((p) => (
          <g key={p}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(p)} y2={y(p)} stroke="var(--color-border)" strokeWidth={p === 0 ? 1 : 0.6} strokeDasharray={p === 0 ? undefined : "2 3"} />
            {(p === 2 || p === 0 || p === -2) && (
              <text x={PAD.l - 6} y={y(p) + 3.5} textAnchor="end" className="num" fontSize="9.5" fill="var(--color-text-muted)">{signedPolarity(p)}</text>
            )}
          </g>
        ))}
        {weeks.length > 0 && (
          <>
            <text x={x(0)} y={H - 4} fontSize="9.5" className="num" fill="var(--color-text-muted)">{shortWeek(weeks[0])}</text>
            <text x={x(steps - 1)} y={H - 4} fontSize="9.5" textAnchor="end" className="num" fill="var(--color-text-muted)">{shortWeek(weeks[weeks.length - 1])}</text>
          </>
        )}
        {hoverStep !== null && (
          <line x1={x(hoverStep)} x2={x(hoverStep)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-border-strong)" strokeWidth={1} />
        )}
        {series.map((s) => (
          <g key={s.sp}>
            <path d={s.d} fill="none" stroke={speakerVar(s.sp)} strokeWidth={2} strokeLinecap="round" />
            {s.pts.map((p) => (
              <circle
                key={p.i}
                cx={x(p.i)}
                cy={y(p.mean)}
                r={Math.min(6.5, 2.8 + Math.sqrt(p.n - 1) * 0.9)}
                fill={speakerVar(s.sp)}
                stroke="var(--color-bg-elevated)"
                strokeWidth={1.5}
                className="cursor-pointer"
                onClick={() => onOpen(p.ids[0])}
              >
                <title>{`${SPEAKER_LABEL[s.sp]} ${rangeLabel(p.i)}: mean ${signedPolarity(p.mean, 2)}, N=${p.n}`}</title>
              </circle>
            ))}
          </g>
        ))}
        {series.length === 0 && (
          <text x={PAD.l + iw / 2} y={PAD.t + ih / 2 + 4} textAnchor="middle" fontSize="11.5" fill="var(--color-text-muted)">No evidence in this range</text>
        )}
      </svg>
      {hoverStep !== null && (
        <div
          className="pointer-events-none absolute z-20 min-w-44 rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-[11.5px] shadow-[var(--shadow-panel)]"
          style={{ left: `${(Math.min(x(hoverStep) + 8, W - 150) / W) * 100}%`, top: 22 }}
        >
          <div className="num text-text-2">{rangeLabel(hoverStep)}</div>
          {hoverCells.length === 0 ? (
            <div className="text-text-muted">No evidence in this span (N = 0)</div>
          ) : (
            hoverCells.map(({ sp, p }) => (
              <div key={sp} className="mt-1 flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-text-2">
                  <span className="h-1.5 w-3 rounded-full" style={{ background: speakerVar(sp) }} />
                  {SPEAKER_LABEL[sp]}
                </span>
                <span className="num text-text">{signedPolarity(p.mean, 2)} <span className="text-text-muted">N={p.n}</span></span>
              </div>
            ))
          )}
        </div>
      )}
    </figure>
  );
}
