/**
 * "What changed": the real difference between two snapshots of the derived layer.
 * Both snapshots come from the same functions (trends, cards, gaps); this module only compares.
 */
import type { AspectKey, EvidenceGap, EvidenceItem, InsightCard, Product, Speaker, TrendCell } from "@contract/types.ts";
import { cellKey } from "../data/trends.ts";

export interface Snapshot {
  evidence: EvidenceItem[];
  trends: TrendCell[];
  cards: InsightCard[];
  gaps: EvidenceGap[];
}

export interface CellChange {
  key: string;
  week: string;
  product: Product;
  speaker: Speaker;
  aspect: AspectKey;
  meanBefore: number | null;
  meanAfter: number | null;
  nBefore: number;
  nAfter: number;
  /** Items that are in the cell after and weren't before. */
  added: string[];
}

export interface CardChange {
  id: string;
  kind: "new" | "changed" | "removed";
  card: InsightCard;
  /** For "changed": which fields moved. */
  fields: string[];
}

export interface Impact {
  cells: CellChange[];
  cards: CardChange[];
  gapsClosed: EvidenceGap[];
  gapsOpened: EvidenceGap[];
  /** True when nothing in trends, cards or gaps moved. */
  empty: boolean;
}

const EMPTY = { mean_polarity: null, n_items: 0, item_ids: [] as string[] };

/**
 * Per-voice cells only (speaker and aspect both specific). The "all" rollups move with them and
 * would repeat the same change.
 */
export function diffCells(before: readonly TrendCell[], after: readonly TrendCell[]): CellChange[] {
  const b = new Map<string, TrendCell>();
  for (const c of before) if (c.speaker !== "all" && c.aspect !== "all") b.set(cellKey(c.week, c.product, c.speaker, c.aspect), c);
  const a = new Map<string, TrendCell>();
  for (const c of after) if (c.speaker !== "all" && c.aspect !== "all") a.set(cellKey(c.week, c.product, c.speaker, c.aspect), c);
  const out: CellChange[] = [];
  for (const key of new Set([...b.keys(), ...a.keys()])) {
    const x = b.get(key) ?? EMPTY;
    const y = a.get(key) ?? EMPTY;
    if (x.mean_polarity === y.mean_polarity && x.n_items === y.n_items && sameIds(x.item_ids, y.item_ids)) continue;
    const ref = (a.get(key) ?? b.get(key))!;
    const prev = new Set(x.item_ids);
    out.push({
      key, week: ref.week, product: ref.product, speaker: ref.speaker as Speaker, aspect: ref.aspect as AspectKey,
      meanBefore: x.mean_polarity, meanAfter: y.mean_polarity, nBefore: x.n_items, nAfter: y.n_items,
      added: y.item_ids.filter((id) => !prev.has(id)),
    });
  }
  return out.sort((p, q) => (p.week === q.week ? p.key.localeCompare(q.key) : q.week.localeCompare(p.week)));
}

function sameIds(x: readonly string[], y: readonly string[]): boolean {
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

const CARD_FIELDS: (keyof InsightCard)[] = ["headline", "citations", "confidence", "fact", "observed_sentiment", "interpretation", "week", "actionable"];

export function diffCards(before: readonly InsightCard[], after: readonly InsightCard[]): CardChange[] {
  const b = new Map(before.map((c) => [c.id, c]));
  const a = new Map(after.map((c) => [c.id, c]));
  const out: CardChange[] = [];
  for (const [id, card] of a) {
    const old = b.get(id);
    if (!old) { out.push({ id, kind: "new", card, fields: [] }); continue; }
    const fields = CARD_FIELDS.filter((f) => JSON.stringify(old[f]) !== JSON.stringify(card[f]));
    if (fields.length) out.push({ id, kind: "changed", card, fields });
  }
  for (const [id, card] of b) if (!a.has(id)) out.push({ id, kind: "removed", card, fields: [] });
  return out;
}

const gapKey = (g: EvidenceGap) => `${g.product}|${g.speaker}|${g.aspect}`;

export function diffGaps(before: readonly EvidenceGap[], after: readonly EvidenceGap[]): { closed: EvidenceGap[]; opened: EvidenceGap[] } {
  const b = new Set(before.map(gapKey));
  const a = new Set(after.map(gapKey));
  return { closed: before.filter((g) => !a.has(gapKey(g))), opened: after.filter((g) => !b.has(gapKey(g))) };
}

export function diffImpact(before: Snapshot, after: Snapshot): Impact {
  const cells = diffCells(before.trends, after.trends);
  const cards = diffCards(before.cards, after.cards);
  const { closed, opened } = diffGaps(before.gaps, after.gaps);
  return { cells, cards, gapsClosed: closed, gapsOpened: opened, empty: !cells.length && !cards.length && !closed.length && !opened.length };
}

/** One plain sentence for the aria-live region and the overlay header. */
export function impactSummary(i: Impact): string {
  if (i.empty) return "Nothing changed. The new evidence didn't move any trend cell, insight card or gap.";
  const parts: string[] = [];
  if (i.cells.length) parts.push(`${i.cells.length} trend cell${i.cells.length === 1 ? "" : "s"} changed`);
  const nNew = i.cards.filter((c) => c.kind === "new").length;
  const nChanged = i.cards.filter((c) => c.kind === "changed").length;
  if (nNew) parts.push(`${nNew} new insight card${nNew === 1 ? "" : "s"}`);
  if (nChanged) parts.push(`${nChanged} insight card${nChanged === 1 ? "" : "s"} updated`);
  if (i.gapsClosed.length) parts.push(`${i.gapsClosed.length} evidence gap${i.gapsClosed.length === 1 ? "" : "s"} closed`);
  if (i.gapsOpened.length) parts.push(`${i.gapsOpened.length} gap${i.gapsOpened.length === 1 ? "" : "s"} opened`);
  const s = parts.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}
