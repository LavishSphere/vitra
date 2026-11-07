/**
 * Weekly trend aggregation. Pure functions, used for the fixture/offline path and for
 * every before/after comparison in the UI. Rules (see the evidence playbook):
 * - bucket = ISO week of `published` (EvidenceItem.iso_week)
 * - one value per (item, aspect); mean polarity, N distinct items, N distinct source types
 * - an empty cell is { mean_polarity: null, n_items: 0 }, never 0.0
 * - no interpolation or smoothing
 */
import type {
  AspectKey, EvidenceItem, Product, Source, Speaker, TrendCell,
} from "@contract/types.ts";
import { weeksBetween } from "../lib/isoWeek.ts";

export type SpeakerKey = Speaker | "all";
export type AspectSel = AspectKey | "all";

export interface Entry {
  item_id: string;
  source: Source;
  week: string;
  product: Product;
  speaker: Speaker;
  aspect: AspectKey;
  polarity: number;
}

export interface Aggregate {
  mean_polarity: number | null;
  n_items: number;
  n_sources: number;
  item_ids: string[];
}

/** Flatten evidence into one entry per (item, aspect), skipping excluded items. */
export function toEntries(evidence: readonly EvidenceItem[], excluded: ReadonlySet<string>): Entry[] {
  const out: Entry[] = [];
  for (const item of evidence) {
    if (excluded.has(item.item_id)) continue;
    for (const a of item.aspects) {
      out.push({
        item_id: item.item_id, source: item.source, week: item.iso_week, product: item.product,
        speaker: a.speaker, aspect: a.aspect, polarity: a.polarity,
      });
    }
  }
  return out;
}

/** The single aggregation core. Everything that shows a mean goes through here. */
export function aggregate(entries: readonly Entry[]): Aggregate {
  if (entries.length === 0) return { mean_polarity: null, n_items: 0, n_sources: 0, item_ids: [] };
  let sum = 0;
  const ids = new Set<string>();
  const sources = new Set<string>();
  for (const e of entries) {
    sum += e.polarity;
    ids.add(e.item_id);
    sources.add(e.source);
  }
  return {
    mean_polarity: Math.round((sum / entries.length) * 100) / 100,
    n_items: ids.size,
    n_sources: sources.size,
    item_ids: [...ids].sort(),
  };
}

export const cellKey = (week: string, product: Product, speaker: SpeakerKey, aspect: AspectSel) =>
  `${week}|${product}|${speaker}|${aspect}`;

export function weekSpan(evidence: readonly EvidenceItem[]): [string, string] | null {
  if (evidence.length === 0) return null;
  let lo = evidence[0].iso_week;
  let hi = lo;
  for (const it of evidence) {
    if (it.iso_week < lo) lo = it.iso_week;
    if (it.iso_week > hi) hi = it.iso_week;
  }
  return [lo, hi];
}

/**
 * Dense weekly grid over the full observed week span, for every (product, speaker, aspect)
 * series that has data anywhere, plus the speaker="all" and aspect="all" rollups.
 * The week span and series list come from all evidence (excluded included), so excluding an
 * item turns its cell into an explicit empty cell instead of removing the row.
 */
export function computeTrends(
  evidence: readonly EvidenceItem[],
  excluded: ReadonlySet<string> = new Set(),
): TrendCell[] {
  const span = weekSpan(evidence);
  if (!span) return [];
  const weeks = weeksBetween(span[0], span[1]);

  const series = new Set<string>();
  for (const e of toEntries(evidence, new Set())) {
    series.add(`${e.product}|${e.speaker}|${e.aspect}`);
    series.add(`${e.product}|all|${e.aspect}`);
    series.add(`${e.product}|${e.speaker}|all`);
    series.add(`${e.product}|all|all`);
  }

  const buckets = new Map<string, Entry[]>();
  const push = (k: string, e: Entry) => {
    const list = buckets.get(k);
    if (list) list.push(e); else buckets.set(k, [e]);
  };
  for (const e of toEntries(evidence, excluded)) {
    push(cellKey(e.week, e.product, e.speaker, e.aspect), e);
    push(cellKey(e.week, e.product, "all", e.aspect), e);
    push(cellKey(e.week, e.product, e.speaker, "all"), e);
    push(cellKey(e.week, e.product, "all", "all"), e);
  }

  const cells: TrendCell[] = [];
  for (const s of [...series].sort()) {
    const [product, speaker, aspect] = s.split("|") as [Product, SpeakerKey, AspectSel];
    for (const week of weeks) {
      const agg = aggregate(buckets.get(cellKey(week, product, speaker, aspect)) ?? []);
      cells.push({ week, product, speaker, aspect, ...agg });
    }
  }
  return cells;
}

export function indexTrends(cells: readonly TrendCell[]): Map<string, TrendCell> {
  const m = new Map<string, TrendCell>();
  for (const c of cells) m.set(cellKey(c.week, c.product, c.speaker, c.aspect), c);
  return m;
}

export interface SummaryQuery {
  product?: Product | "all";
  aspect?: AspectSel;
  speaker?: SpeakerKey;
  weekFrom?: string;
  weekTo?: string;
}

/** Aggregate over a window (same core as the weekly cells). */
export function computeSummary(
  evidence: readonly EvidenceItem[],
  excluded: ReadonlySet<string>,
  q: SummaryQuery,
): Aggregate {
  const entries = toEntries(evidence, excluded).filter((e) =>
    (!q.product || q.product === "all" || e.product === q.product) &&
    (!q.aspect || q.aspect === "all" || e.aspect === q.aspect) &&
    (!q.speaker || q.speaker === "all" || e.speaker === q.speaker) &&
    (!q.weekFrom || e.week >= q.weekFrom) &&
    (!q.weekTo || e.week <= q.weekTo));
  return aggregate(entries);
}

export interface WhatIfRow {
  aspect: AspectKey;
  speaker: Speaker;
  week: string;
  product: Product;
  cellBefore: Aggregate;
  cellAfter: Aggregate;
  windowBefore: Aggregate;
  windowAfter: Aggregate;
}

/**
 * Before/after for toggling one item. "before" = the current exclusion set, "after" = the set
 * with this item toggled. Both sides come from the same functions.
 */
export function whatIf(
  evidence: readonly EvidenceItem[],
  excluded: ReadonlySet<string>,
  itemId: string,
  window: { weekFrom?: string; weekTo?: string } = {},
): WhatIfRow[] {
  const item = evidence.find((e) => e.item_id === itemId);
  if (!item) return [];
  const after = new Set(excluded);
  if (after.has(itemId)) after.delete(itemId); else after.add(itemId);
  return item.aspects.map((a) => {
    const cellQ: SummaryQuery = { product: item.product, aspect: a.aspect, speaker: a.speaker, weekFrom: item.iso_week, weekTo: item.iso_week };
    const winQ: SummaryQuery = { product: item.product, aspect: a.aspect, speaker: "all", ...window };
    return {
      aspect: a.aspect, speaker: a.speaker, week: item.iso_week, product: item.product,
      cellBefore: computeSummary(evidence, excluded, cellQ),
      cellAfter: computeSummary(evidence, after, cellQ),
      windowBefore: computeSummary(evidence, excluded, winQ),
      windowAfter: computeSummary(evidence, after, winQ),
    };
  });
}
