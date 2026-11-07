import { describe, expect, it } from "vitest";
import type { EvidenceItem, InsightCard, EvidenceGap, TrendCell } from "@contract/types.ts";
import { ASPECTS } from "@contract/types.ts";
import evidenceJson from "../fixtures/evidence.json";
import cardsJson from "../fixtures/cards.json";
import gapsJson from "../fixtures/gaps.json";
import trendsJson from "../fixtures/trends.json";
import intakeJson from "../fixtures/intake.json";
import { spanIsVerified } from "./spans.ts";
import { computeTrends } from "./trends.ts";
import { computeGaps } from "./gaps.ts";
import { isoWeekOf } from "../lib/isoWeek.ts";
import { levelFor, rubricPoints } from "./confidence.ts";

const evidence = evidenceJson as EvidenceItem[];
const cards = cardsJson as InsightCard[];

describe("synthetic fixtures", () => {
  it("are all synthetic and SYN- prefixed", () => {
    for (const it of evidence) {
      expect(it.origin).toBe("synthetic_demo");
      expect(it.item_id).toMatch(/^SYN-\d{4}$/);
      expect(it.url).toBe(`urn:vitra:synthetic:${it.item_id}`);
    }
  });

  it("has every span as an exact substring at its stated offsets", () => {
    let n = 0;
    for (const it of [...evidence, intakeJson.evidence as EvidenceItem]) {
      for (const a of it.aspects) {
        expect(it.text.includes(a.span), `${it.item_id} ${a.aspect}`).toBe(true);
        expect(it.text.slice(a.span_start, a.span_end)).toBe(a.span);
        expect(spanIsVerified(it.text, a)).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(50);
  });

  it("has iso_week matching published", () => {
    for (const it of evidence) expect(it.iso_week).toBe(isoWeekOf(it.published));
  });

  it("covers all 7 sources, all 5 aspects, both products", () => {
    expect(new Set(evidence.map((e) => e.source)).size).toBe(7);
    const aspects = new Set(evidence.flatMap((e) => e.aspects.map((a) => a.aspect)));
    for (const a of ASPECTS) expect(aspects.has(a)).toBe(true);
    expect(new Set(evidence.map((e) => e.product))).toEqual(new Set(["A", "B", "both"]));
  });

  it("cites only real spans in insight cards", () => {
    const byId = new Map(evidence.map((e) => [e.item_id, e]));
    for (const c of cards) {
      expect(c.citations.length).toBeGreaterThan(0);
      for (const cit of c.citations) {
        const item = byId.get(cit.item_id)!;
        expect(item, cit.item_id).toBeDefined();
        const a = item.aspects.find((x) => x.aspect === cit.aspect)!;
        expect(a.span).toBe(cit.span);
        expect(item.text.slice(cit.span_start, cit.span_end)).toBe(cit.span);
      }
    }
  });

  it("has confidence that matches the documented rubric", () => {
    for (const it of evidence) {
      const c = it.confidence;
      expect(c.level).toBe(levelFor(rubricPoints(c), c.span_verified));
    }
  });

  it("stores trends and gaps that match a fresh recompute", () => {
    expect(computeTrends(evidence)).toEqual(trendsJson as TrendCell[]);
    expect(computeGaps(evidence, new Set(), 8)).toEqual(gapsJson as EvidenceGap[]);
  });
});
