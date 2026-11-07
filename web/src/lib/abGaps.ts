/**
 * Pair each expected voice across products A and B so the Gaps rail can show
 * "where's the gap" as a side-by-side empty-cell compare.
 */
import type { AspectKey, EvidenceGap, Speaker } from "@contract/types.ts";
import type { Voice } from "../data/gaps.ts";

export type GapSide = "missing" | "present";

export interface AbGapRow {
  speaker: Speaker;
  aspect: AspectKey;
  window_weeks: number;
  a: GapSide;
  b: GapSide;
  gapA: EvidenceGap | null;
  gapB: EvidenceGap | null;
}

/** Build one row per voice. A/B status comes from the gap list (missing) vs voices checked. */
export function abGapRows(
  gaps: readonly EvidenceGap[],
  voices: readonly Voice[],
  windowWeeks = 8,
): AbGapRow[] {
  const miss = new Map<string, EvidenceGap>();
  for (const g of gaps) {
    if (g.product !== "A" && g.product !== "B") continue;
    miss.set(`${g.product}|${g.speaker}|${g.aspect}`, g);
  }
  return voices.map((v) => {
    const gapA = miss.get(`A|${v.speaker}|${v.aspect}`) ?? null;
    const gapB = miss.get(`B|${v.speaker}|${v.aspect}`) ?? null;
    return {
      speaker: v.speaker,
      aspect: v.aspect,
      window_weeks: gapA?.window_weeks ?? gapB?.window_weeks ?? windowWeeks,
      a: gapA ? "missing" : "present",
      b: gapB ? "missing" : "present",
      gapA,
      gapB,
    };
  });
}

export function abCompareIntro(windowWeeks: number): string {
  return `Tagrisso (A) next to Rybrevant (B) for each voice a launch team expects. "Missing" means no quotes in the last ${windowWeeks} ISO weeks. Click a missing cell to focus that product.`;
}

export function abSideLabel(side: GapSide): string {
  return side === "missing" ? "missing" : "covered";
}
