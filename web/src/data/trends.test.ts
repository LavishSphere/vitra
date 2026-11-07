import { describe, expect, it } from "vitest";
import type { EvidenceItem } from "@contract/types.ts";
import { computeTrends, computeSummary, indexTrends, cellKey, whatIf } from "./trends.ts";
import { computeGaps } from "./gaps.ts";
import { isoWeekOf, weeksBetween } from "../lib/isoWeek.ts";
import { segmentText } from "./spans.ts";

function item(id: string, date: string, product: "A" | "B", aspects: [string, number, string][], source = "news"): EvidenceItem {
  const text = aspects.map(([, , , ], i) => `Sentence ${i} of ${id}.`).join(" ");
  return {
    item_id: id, source: source as EvidenceItem["source"], url: "", published: date, iso_week: isoWeekOf(date),
    product, title: id, text, signal_type: "none", actionable: "no", origin: "synthetic_demo",
    aspects: aspects.map(([aspect, polarity, speaker], i) => {
      const span = `Sentence ${i} of ${id}.`;
      const start = text.indexOf(span);
      return { aspect, polarity, speaker, span, span_start: start, span_end: start + span.length } as EvidenceItem["aspects"][number];
    }),
    confidence: { level: "low", method: "model", span_verified: true, source_authority: "news", corroborating_items: 0, notes: [] },
  };
}

const ev = [
  item("X1", "2025-01-06", "A", [["safety", -2, "hcp"]]),             // W02
  item("X2", "2025-01-08", "A", [["safety", 0, "hcp"]], "pubmed"),    // W02
  item("X3", "2025-01-22", "A", [["safety", 1, "hcp"], ["efficacy", 2, "hcp"]]), // W04
  item("X4", "2025-01-22", "B", [["access_cost", -1, "payer"]]),      // W04
];

describe("iso weeks", () => {
  it("handles year boundaries", () => {
    expect(isoWeekOf("2024-12-30")).toBe("2025-W01");
    expect(isoWeekOf("2021-01-03")).toBe("2020-W53");
    expect(isoWeekOf("2025-06-02")).toBe("2025-W23");
    expect(weeksBetween("2020-W52", "2021-W02")).toEqual(["2020-W52", "2020-W53", "2021-W01", "2021-W02"]);
  });
});

describe("computeTrends", () => {
  const idx = indexTrends(computeTrends(ev));

  it("means one value per (item, aspect) and counts distinct items and sources", () => {
    const c = idx.get(cellKey("2025-W02", "A", "hcp", "safety"))!;
    expect(c.mean_polarity).toBe(-1);
    expect(c.n_items).toBe(2);
    expect(c.n_sources).toBe(2);
    expect(c.item_ids).toEqual(["X1", "X2"]);
  });

  it("keeps empty weeks as null with N=0, never 0.0, and never interpolates", () => {
    const c = idx.get(cellKey("2025-W03", "A", "hcp", "safety"))!;
    expect(c).toBeDefined();
    expect(c.mean_polarity).toBeNull();
    expect(c.n_items).toBe(0);
  });

  it("builds speaker and aspect rollups", () => {
    expect(idx.get(cellKey("2025-W04", "A", "all", "all"))!.mean_polarity).toBe(1.5);
    expect(idx.get(cellKey("2025-W04", "A", "hcp", "all"))!.n_items).toBe(1);
    expect(idx.get(cellKey("2025-W04", "B", "all", "access_cost"))!.mean_polarity).toBe(-1);
  });

  it("recomputes from evidence when an item is excluded", () => {
    const after = indexTrends(computeTrends(ev, new Set(["X1"])));
    const c = after.get(cellKey("2025-W02", "A", "hcp", "safety"))!;
    expect(c.mean_polarity).toBe(0);
    expect(c.n_items).toBe(1);
    const gone = indexTrends(computeTrends(ev, new Set(["X1", "X2"]))).get(cellKey("2025-W02", "A", "hcp", "safety"))!;
    expect(gone.mean_polarity).toBeNull();
    expect(gone.n_items).toBe(0);
  });

  it("restoring an item returns the original grid exactly", () => {
    expect(computeTrends(ev, new Set())).toEqual(computeTrends(ev));
  });
});

describe("whatIf", () => {
  it("reports before/after from the same aggregation", () => {
    const rows = whatIf(ev, new Set(), "X1");
    expect(rows).toHaveLength(1);
    expect(rows[0].cellBefore.mean_polarity).toBe(-1);
    expect(rows[0].cellAfter.mean_polarity).toBe(0);
    expect(rows[0].windowBefore).toEqual(computeSummary(ev, new Set(), { product: "A", aspect: "safety" }));
    // toggling an excluded item restores it
    const back = whatIf(ev, new Set(["X1"]), "X1");
    expect(back[0].cellAfter.mean_polarity).toBe(-1);
  });
});

describe("computeGaps", () => {
  it("flags expected voices with zero items in the window", () => {
    const gaps = computeGaps(ev, new Set(), 2);
    const payerB = gaps.find((g) => g.product === "B" && g.speaker === "payer");
    expect(payerB).toBeUndefined();
    const payerA = gaps.find((g) => g.product === "A" && g.speaker === "payer")!;
    expect(payerA.n_items_in_window).toBe(0);
    expect(payerA.last_seen_week).toBeNull();
    const hcpSafetyA = computeGaps(ev, new Set(["X3"]), 2).find((g) => g.product === "A" && g.speaker === "hcp" && g.aspect === "safety")!;
    expect(hcpSafetyA.last_seen_week).toBe("2025-W02");
  });
});

describe("segmentText", () => {
  it("splits overlapping spans", () => {
    const text = "abcdefghij";
    const segs = segmentText(text, [
      { aspect: "safety", polarity: 0, speaker: "hcp", span: "cdef", span_start: 2, span_end: 6 },
      { aspect: "efficacy", polarity: 0, speaker: "hcp", span: "efgh", span_start: 4, span_end: 8 },
    ]);
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.find((s) => s.text === "ef")!.aspects).toHaveLength(2);
  });
});
