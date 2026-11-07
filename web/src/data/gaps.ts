/**
 * Evidence gaps: expected (product, speaker, aspect) voices with no evidence in the last
 * `windowWeeks` ISO weeks. Items tagged product "both" count toward A and B.
 */
import type { AspectKey, EvidenceGap, EvidenceItem, Speaker } from "@contract/types.ts";
import { weeksBetween } from "../lib/isoWeek.ts";
import { weekSpan } from "./trends.ts";

export interface Voice { speaker: Speaker; aspect: AspectKey; }

/** Voices a launch team would expect to hear from. Documented, not learned. */
export const EXPECTED_VOICES: Voice[] = [
  { speaker: "payer", aspect: "access_cost" },
  { speaker: "patient", aspect: "convenience" },
  { speaker: "patient", aspect: "safety" },
  { speaker: "hcp", aspect: "efficacy" },
  { speaker: "hcp", aspect: "safety" },
  { speaker: "regulator", aspect: "safety" },
  { speaker: "researcher", aspect: "evidence_quality" },
];

export function computeGaps(
  evidence: readonly EvidenceItem[],
  excluded: ReadonlySet<string>,
  windowWeeks = 8,
  endWeek?: string,
  voices: Voice[] = EXPECTED_VOICES,
): EvidenceGap[] {
  const span = weekSpan(evidence);
  if (!span) return [];
  const end = endWeek ?? span[1];
  const all = weeksBetween(span[0], end);
  const windowStart = all[Math.max(0, all.length - windowWeeks)];
  const gaps: EvidenceGap[] = [];
  for (const product of ["A", "B"] as const) {
    for (const v of voices) {
      const inWindow = new Set<string>();
      let last: string | null = null;
      for (const it of evidence) {
        if (excluded.has(it.item_id)) continue;
        if (it.product !== product && it.product !== "both") continue;
        if (it.iso_week > end) continue;
        if (!it.aspects.some((a) => a.aspect === v.aspect && a.speaker === v.speaker)) continue;
        if (last === null || it.iso_week > last) last = it.iso_week;
        if (it.iso_week >= windowStart) inWindow.add(it.item_id);
      }
      if (inWindow.size === 0) {
        gaps.push({ product, speaker: v.speaker, aspect: v.aspect, window_weeks: windowWeeks, n_items_in_window: 0, last_seen_week: last });
      }
    }
  }
  return gaps;
}
