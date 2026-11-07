/**
 * The spectral lens: one summary per aspect for the current filters and week range.
 * Pure. Every number comes from computeSummary (the same core as the weekly trend cells),
 * so the ring around the lungs, the lens chips and the trend chart can never disagree.
 * An aspect with no evidence has mean null and N 0. It is never shown as 0.
 */
import { ASPECTS, type AspectKey, type EvidenceItem, type Polarity } from "@contract/types.ts";
import { computeSummary, type Aggregate } from "./trends.ts";
import { matchesItem, type Filters, type Mark } from "../store/useVitra.ts";

export type LensFocus = AspectKey | "all";

export interface LensSlice extends Aggregate {
  aspect: AspectKey;
  /** Polarity of every counted (item, aspect) entry, sorted low to high. One bead each on the ring. */
  polarities: Polarity[];
}

export interface LensSummary {
  focus: LensFocus;
  /** The focused aspect, or every aspect pooled when the focus is "all". */
  overall: Aggregate;
  /** Every aspect pooled, whatever the focus (the "All aspects" chip). */
  pooled: Aggregate;
  /** Always five slices, in ASPECTS order, whatever the focus. */
  slices: LensSlice[];
}

/** Items that pass every filter except aspect and speaker (those apply per aspect entry). */
function itemsInView(evidence: readonly EvidenceItem[], f: Filters): EvidenceItem[] {
  return evidence.filter((it) => matchesItem(it, f));
}

export function lensSummary(evidence: readonly EvidenceItem[], excluded: readonly string[], f: Filters): LensSummary {
  const ex = new Set(excluded);
  const items = itemsInView(evidence, f);
  const slices = ASPECTS.map((aspect): LensSlice => {
    const agg = computeSummary(items, ex, { aspect, speaker: f.speaker });
    const polarities: Polarity[] = [];
    for (const it of items) {
      if (ex.has(it.item_id)) continue;
      for (const a of it.aspects) {
        if (a.aspect === aspect && (f.speaker === "all" || a.speaker === f.speaker)) polarities.push(a.polarity);
      }
    }
    polarities.sort((x, y) => x - y);
    return { aspect, ...agg, polarities };
  });
  const pooled = computeSummary(items, ex, { aspect: "all", speaker: f.speaker });
  const overall = f.aspect === "all" ? pooled : computeSummary(items, ex, { aspect: f.aspect, speaker: f.speaker });
  return { focus: f.aspect, overall, pooled, slices };
}

/**
 * Marks that the lens dims: they pass every filter except the aspect, and the aspect is not the
 * focused one. Empty when the focus is "all" (nothing is dimmed).
 */
export function lensGhosts(marks: readonly Mark[], f: Filters): Mark[] {
  if (f.aspect === "all") return [];
  return marks.filter((m) => !m.visible
    && m.aspect.aspect !== f.aspect
    && (f.speaker === "all" || m.aspect.speaker === f.speaker)
    && matchesItem(m.item, f));
}

/** Ring geometry: five equal arcs with a small gap, in ASPECTS order. Angles in radians. */
export const RING_GAP = 0.09;
export const RING_ARC = (Math.PI * 2) / ASPECTS.length - RING_GAP;

export function sliceStart(index: number): number {
  return index * ((Math.PI * 2) / ASPECTS.length) + RING_GAP / 2;
}

export function sliceMid(index: number): number {
  return sliceStart(index) + RING_ARC / 2;
}

/**
 * Spin (about the vertical axis) that brings a slice's midpoint to the front, given that the
 * front of the ring is at angle `front`. Picks the turn closest to `current` so the dial never
 * spins the long way round.
 */
export function spinToFront(index: number, front: number, current: number): number {
  let s = front - sliceMid(index);
  const twoPi = Math.PI * 2;
  while (s - current > Math.PI) s -= twoPi;
  while (current - s > Math.PI) s += twoPi;
  return s;
}

/** Readout text for one slice. Null mean reads "no evidence", never "0". */
export function sliceReadout(a: Pick<Aggregate, "mean_polarity" | "n_items" | "n_sources">): { mean: string; count: string } {
  if (a.mean_polarity === null || a.n_items === 0) return { mean: "no evidence", count: "N 0" };
  const m = a.mean_polarity;
  const mean = m > 0 ? `+${m.toFixed(2)}` : m < 0 ? `−${Math.abs(m).toFixed(2)}` : "0.00";
  const items = a.n_items === 1 ? "1 item" : `${a.n_items} items`;
  const sources = a.n_sources === 1 ? "1 source type" : `${a.n_sources} source types`;
  return { mean, count: `${items}, ${sources}` };
}
