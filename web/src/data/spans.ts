import type { AspectEvidence, EvidenceItem } from "@contract/types.ts";

/** A span is displayable only if it sits at its stated offsets in the item text. */
export function spanIsVerified(text: string, a: Pick<AspectEvidence, "span" | "span_start" | "span_end">): boolean {
  return (
    a.span.length > 0 &&
    a.span_start >= 0 &&
    a.span_end === a.span_start + a.span.length &&
    text.slice(a.span_start, a.span_end) === a.span
  );
}

/** Drop any aspect whose span does not verify. Never render an unverified quote. */
export function displayableAspects(item: EvidenceItem): AspectEvidence[] {
  return item.aspects.filter((a) => spanIsVerified(item.text, a));
}

export interface TextSegment { text: string; aspects: AspectEvidence[]; start: number; }

/** Split text into segments so overlapping spans can be highlighted. */
export function segmentText(text: string, aspects: readonly AspectEvidence[]): TextSegment[] {
  const cuts = new Set<number>([0, text.length]);
  for (const a of aspects) { cuts.add(a.span_start); cuts.add(a.span_end); }
  const points = [...cuts].filter((c) => c >= 0 && c <= text.length).sort((x, y) => x - y);
  const segs: TextSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i];
    const e = points[i + 1];
    if (e <= s) continue;
    segs.push({ text: text.slice(s, e), start: s, aspects: aspects.filter((a) => a.span_start <= s && a.span_end >= e) });
  }
  return segs;
}
