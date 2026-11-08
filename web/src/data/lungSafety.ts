/**
 * Lung-safety evidence: items whose verified quote or source text mentions interstitial lung
 * disease (ILD), pneumonitis or lung toxicity. All four labels list ILD/pneumonitis as a warning
 * (Tagrisso PI 5.1; Rybrevant PI 5.2; Rybrevant Faspro PI 5.2; Lazcluze PI 5.2).
 *
 * Pure functions only. The 3D pins and their DOM labels read from here.
 */
import type { AspectKey, EvidenceItem, Polarity } from "@contract/types.ts";
import { spanIsVerified } from "./spans.ts";

/** Case-insensitive, word-bounded. Plurals included so "diseases" and "toxicities" still count. */
export const LUNG_SAFETY_PATTERN = /\b(?:ILD|interstitial lung diseases?|pneumonitis|lung toxicit(?:y|ies))\b/i;

export function mentionsLungSafety(s: string): boolean {
  return LUNG_SAFETY_PATTERN.test(s);
}

export interface LungSafetyHit {
  item: EvidenceItem;
  /** The aspect whose verified span names the term, or null when only the source text does. */
  aspect: AspectKey | null;
  /** Polarity of that aspect. Null for a text-only match: we never borrow another aspect's tone. */
  polarity: Polarity | null;
  /** An exact substring of item.text: the verified span, or the sentence that holds the term. */
  quote: string;
  quoteKind: "span" | "text";
  /** The matched words, as written in the source. */
  term: string;
}

/** The sentence around `index`, returned as an exact substring of `text`. */
export function sentenceAround(text: string, index: number): string {
  let start = 0;
  const before = /[.!?]\s+/g;
  let m: RegExpExecArray | null;
  while ((m = before.exec(text)) && m.index < index) start = m.index + m[0].length;
  const after = /[.!?](?=\s|$)/g;
  after.lastIndex = index;
  const end = after.exec(text);
  return text.slice(start, end ? end.index + 1 : text.length).trim();
}

/** One hit per item at most. A matching safety span wins, then any matching span, then the text. */
export function lungSafetyHit(item: EvidenceItem): LungSafetyHit | null {
  const spans = item.aspects.filter((a) => spanIsVerified(item.text, a) && mentionsLungSafety(a.span));
  const a = spans.find((x) => x.aspect === "safety") ?? spans[0];
  if (a) {
    const term = a.span.match(LUNG_SAFETY_PATTERN)![0];
    return { item, aspect: a.aspect, polarity: a.polarity, quote: a.span, quoteKind: "span", term };
  }
  const m = item.text.match(LUNG_SAFETY_PATTERN);
  if (!m || m.index === undefined) return null;
  return { item, aspect: null, polarity: null, quote: sentenceAround(item.text, m.index), quoteKind: "text", term: m[0] };
}

export interface LungSafetyFilter { product: "A" | "B" | "all"; weekFrom: string; weekTo: string; }

/** Same product and week rules as the store's matchesItem. Sorted by week, then id. */
export function lungSafetyEvidence(items: readonly EvidenceItem[], f?: LungSafetyFilter): LungSafetyHit[] {
  const out: LungSafetyHit[] = [];
  for (const item of items) {
    if (f) {
      if (f.product !== "all" && item.product !== f.product) continue;
      if (f.weekFrom && item.iso_week < f.weekFrom) continue;
      if (f.weekTo && item.iso_week > f.weekTo) continue;
    }
    const hit = lungSafetyHit(item);
    if (hit) out.push(hit);
  }
  return out.sort((x, y) => x.item.iso_week.localeCompare(y.item.iso_week) || x.item.item_id.localeCompare(y.item.item_id));
}

/** Split a quote around the matched term so the UI can highlight it. */
export function splitOnTerm(quote: string): { before: string; term: string; after: string } {
  const m = quote.match(LUNG_SAFETY_PATTERN);
  if (!m || m.index === undefined) return { before: quote, term: "", after: "" };
  return { before: quote.slice(0, m.index), term: m[0], after: quote.slice(m.index + m[0].length) };
}

// ---------------------------------------------------------------------------------------------
// Illustrative placement. A pin's spot depends only on its item_id, so it never moves between
// loads or when other items come and go. The spot carries no anatomical meaning.

/** FNV-1a, 32 bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Surface samples: xyz positions and unit normals, packed. */
export interface SurfaceSamples { positions: ArrayLike<number>; normals: ArrayLike<number>; count: number; }

export interface PinSpot { x: number; y: number; z: number; nx: number; ny: number; nz: number; }

export interface PlacementRules {
  /** Keep pins this far from a point (the tumor hotspot), so no one reads a link between them. */
  avoid?: { x: number; y: number; z: number; radius: number };
  /** Lowest allowed normal z: keeps pins on the side the default camera sees. */
  minFacing?: number;
  /** Allowed height band, so pins stay off the apex and the diaphragm outline. */
  yRange?: [number, number];
}

export function pinSpot(itemId: string, surface: SurfaceSamples, rules: PlacementRules = {}): PinSpot {
  const rnd = mulberry32(hashString(itemId));
  const { positions: p, normals: n, count } = surface;
  const minFacing = rules.minFacing ?? 0.15;
  let pick = 0;
  for (let tries = 0; tries < 64; tries++) {
    const i = Math.min(count - 1, Math.floor(rnd() * count));
    pick = i;
    const o = i * 3;
    if (n[o + 2] < minFacing) continue;
    // Outer faces only: the medial faces sit against each other and hide pins, and a pin on
    // the outer curve shows its stem in profile.
    if (n[o] * Math.sign(p[o]) < 0.1) continue;
    if (rules.yRange && (p[o + 1] < rules.yRange[0] || p[o + 1] > rules.yRange[1])) continue;
    // Skip the apex and the base, where a pin reads as part of the outline.
    if (Math.abs(n[o + 1]) > 0.8) continue;
    const av = rules.avoid;
    if (av && Math.hypot(p[o] - av.x, p[o + 1] - av.y, p[o + 2] - av.z) < av.radius) continue;
    break;
  }
  const o = pick * 3;
  return { x: p[o], y: p[o + 1], z: p[o + 2], nx: n[o], ny: n[o + 1], nz: n[o + 2] };
}
