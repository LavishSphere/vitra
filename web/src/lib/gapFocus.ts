/**
 * A gap row is one {product, speaker, aspect} cell over a recent ISO-week window.
 * Focusing it writes those filters so the scene and the timeline show that cell.
 * A count of zero is missing evidence. It is never rendered as a polarity of zero.
 */
import type { AspectKey, EvidenceGap, Speaker } from "@contract/types.ts";

export const GAP_TITLE = "Where's the gap";

export function gapIntro(windowWeeks: number): string {
  return `Where market evidence stops short of the voices a launch team still needs. Each row is one product, one speaker, and one aspect in the last ${windowWeeks} ISO weeks. A count of zero is missing evidence. Click a row to focus the scene and the timeline on that cell.`;
}

export function gapEmptyLine(product: "A" | "B" | "all"): string {
  if (product === "all") return "Every checked voice has evidence in the window.";
  return "This product has evidence for every checked voice in the window.";
}

export const MISSING_CELL = "No quotes in this cell. Missing evidence leaves the scene empty.";

export interface GapFocusPatch {
  product: "A" | "B" | "all";
  speaker: Speaker;
  aspect: AspectKey;
  source: "all";
  signalType: "all";
  weekFrom?: string;
  weekTo?: string;
}

export function gapFocus(
  gap: Pick<EvidenceGap, "product" | "speaker" | "aspect" | "window_weeks">,
  weeks: readonly string[],
): GapFocusPatch {
  const patch: GapFocusPatch = {
    product: gap.product === "both" ? "all" : gap.product,
    speaker: gap.speaker,
    aspect: gap.aspect,
    source: "all",
    signalType: "all",
  };
  if (weeks.length > 0) {
    const n = Math.max(1, gap.window_weeks);
    patch.weekFrom = weeks[Math.max(0, weeks.length - n)];
    patch.weekTo = weeks[weeks.length - 1];
  }
  return patch;
}

/** Count in the gap window. Zero is the word "missing", never "0" or "neutral". */
export function gapCountLabel(n: number): string {
  if (n <= 0) return "missing";
  return String(n);
}

export function gapRowName(
  productLabel: string,
  speakerLabel: string,
  aspectLabel: string,
  n: number,
  windowWeeks: number,
): string {
  const count = n <= 0 ? "Missing" : `${n} in the window`;
  return `${productLabel}, ${speakerLabel} on ${aspectLabel}. ${count}, last ${windowWeeks} weeks. Focus this cell.`;
}

export function gapIsFocused(
  filters: { product: string; speaker: string; aspect: string },
  gap: { product: EvidenceGap["product"]; speaker: Speaker; aspect: AspectKey },
): boolean {
  const product = gap.product === "both" ? "all" : gap.product;
  return filters.product === product && filters.speaker === gap.speaker && filters.aspect === gap.aspect;
}

export function missingCellMessage(
  visibleQuotes: number,
  filters: { speaker: string; aspect: string },
): string | null {
  if (filters.speaker === "all" || filters.aspect === "all") return null;
  if (visibleQuotes > 0) return null;
  return MISSING_CELL;
}

export function rangeQuoteLabel(n: number): string {
  if (n <= 0) return "no quotes in range";
  return `${n} items with quotes`;
}
