/**
 * Confidence rubric (documented, never a probability). Mirrors app/evidence.py so the quote panel
 * explains the same points the API computes.
 * points = method + source authority + (1 if at least 2 corroborating items).
 * Level: low if the span is unverified, else high >= 4, medium >= 2, low otherwise.
 * Corroborating item: same aspect and polarity sign within +/-2 ISO weeks, overlapping product.
 */
import type { Confidence, Source } from "@contract/types.ts";

export const AUTHORITY_BY_SOURCE: Record<Source, Confidence["source_authority"]> = {
  fda_label: "regulator", fda_notice: "regulator", ctgov: "registry", pubmed: "peer_reviewed",
  press_release: "company", news: "news", fda_event: "news", transcript: "news",
};

export const AUTHORITY_POINTS: Record<Confidence["source_authority"], number> = {
  regulator: 2, registry: 2, peer_reviewed: 1, company: 0, news: 0, private: 0,
};

export const AUTHORITY_ORDER: Confidence["source_authority"][] = ["regulator", "registry", "peer_reviewed", "company", "news", "private"];

export const METHOD_POINTS: Record<Confidence["method"], number> = { gold: 2, rule: 1, mixed: 1, model: 0 };

export const CORROBORATION_WINDOW_WEEKS = 2;
export const CORROBORATION_MIN = 2;

export const corroborationPoints = (n: number) => (n >= CORROBORATION_MIN ? 1 : 0);

export function rubricPoints(c: Pick<Confidence, "source_authority" | "method" | "corroborating_items">): number {
  return METHOD_POINTS[c.method] + (AUTHORITY_POINTS[c.source_authority] ?? 0) + corroborationPoints(c.corroborating_items);
}

export function levelFor(points: number, spanVerified = true): Confidence["level"] {
  if (!spanVerified) return "low";
  return points >= 4 ? "high" : points >= 2 ? "medium" : "low";
}

export const RUBRIC_TEXT =
  "Method (rule 1, model 0) + source authority (regulator or registry 2, peer-reviewed 1, others 0) + 1 when 2 or more items agree within 2 weeks. High is 4 or more, medium 2 to 3, and an unverified quote is always low. A rubric score, not a probability.";
