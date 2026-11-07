import { describe, expect, it } from "vitest";
import type { EvidenceItem } from "@contract/types.ts";
import { lensGhosts, lensSummary, sliceMid, sliceReadout, spinToFront } from "./lens.ts";
import { computeSummary } from "./trends.ts";
import { isoWeekOf } from "../lib/isoWeek.ts";
import type { Filters, Mark } from "../store/useVitra.ts";
import { stationFor } from "./stations.ts";

function item(id: string, date: string, product: "A" | "B", aspects: [string, number, string][], source = "news"): EvidenceItem {
  const text = aspects.map((_, i) => `Sentence ${i} of ${id}.`).join(" ");
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
  item("X1", "2025-01-06", "A", [["safety", -2, "hcp"]]), // W02
  item("X2", "2025-01-08", "A", [["safety", 0, "patient"]], "pubmed"), // W02
  item("X3", "2025-01-22", "A", [["safety", 1, "hcp"], ["efficacy", 2, "hcp"]]), // W04
  item("X4", "2025-01-22", "B", [["access_cost", -1, "payer"]]), // W04
];

const all = (over: Partial<Filters> = {}): Filters => ({
  product: "all", weekFrom: "2025-W02", weekTo: "2025-W04", speaker: "all", aspect: "all", source: "all", signalType: "all", ...over,
});

const slice = (s: ReturnType<typeof lensSummary>, a: string) => s.slices.find((x) => x.aspect === a)!;

describe("lensSummary", () => {
  it("returns five slices whose numbers match computeSummary exactly", () => {
    const s = lensSummary(ev, [], all());
    expect(s.slices.map((x) => x.aspect)).toEqual(["efficacy", "safety", "convenience", "access_cost", "evidence_quality"]);
    const ref = computeSummary(ev, new Set(), { aspect: "safety" });
    expect(slice(s, "safety")).toMatchObject({ mean_polarity: ref.mean_polarity, n_items: 3, n_sources: 2, item_ids: ["X1", "X2", "X3"] });
    expect(slice(s, "safety").mean_polarity).toBe(-0.33);
    expect(slice(s, "safety").polarities).toEqual([-2, 0, 1]);
  });

  it("shows an aspect with no evidence as null with N 0, never 0", () => {
    const s = lensSummary(ev, [], all());
    expect(slice(s, "convenience").mean_polarity).toBeNull();
    expect(slice(s, "convenience").n_items).toBe(0);
    expect(slice(s, "convenience").polarities).toEqual([]);
  });

  it("honours product, week range, speaker, source and exclusions", () => {
    expect(slice(lensSummary(ev, [], all({ product: "B" })), "safety").n_items).toBe(0);
    expect(slice(lensSummary(ev, [], all({ weekFrom: "2025-W04" })), "safety").item_ids).toEqual(["X3"]);
    expect(slice(lensSummary(ev, [], all({ speaker: "hcp" })), "safety").mean_polarity).toBe(-0.5);
    expect(slice(lensSummary(ev, [], all({ source: "pubmed" })), "safety").item_ids).toEqual(["X2"]);
    expect(slice(lensSummary(ev, ["X1"], all()), "safety").mean_polarity).toBe(0.5);
  });

  it("overall follows the focused aspect, or pools every aspect for all", () => {
    expect(lensSummary(ev, [], all({ aspect: "safety" })).overall.mean_polarity).toBe(-0.33);
    expect(lensSummary(ev, [], all()).overall.n_items).toBe(4);
    expect(lensSummary(ev, [], all({ aspect: "convenience" })).overall.mean_polarity).toBeNull();
    expect(lensSummary(ev, [], all({ aspect: "convenience" })).pooled.n_items).toBe(4);
  });

  it("is empty but well formed for no evidence", () => {
    const s = lensSummary([], [], all());
    expect(s.slices).toHaveLength(5);
    expect(s.overall.mean_polarity).toBeNull();
  });
});

describe("lensGhosts", () => {
  const marks: Mark[] = ev.flatMap((it, i) => it.aspects.map((a, j) => ({
    index: i * 10 + j, key: `${it.item_id}:${a.aspect}`, item: it, aspect: a, station: stationFor(a.aspect, a.speaker),
    visible: false, excluded: false,
  })));

  it("dims nothing when the lens is on all aspects", () => {
    expect(lensGhosts(marks, all())).toEqual([]);
  });

  it("dims the other aspects that pass every other filter", () => {
    const f = all({ aspect: "safety", product: "A" });
    const keys = lensGhosts(marks.map((m) => ({ ...m, visible: m.aspect.aspect === "safety" && m.item.product === "A" })), f).map((m) => m.key);
    expect(keys).toEqual(["X3:efficacy"]);
  });
});

describe("ring geometry and readouts", () => {
  it("spins the short way to bring a slice to the front", () => {
    const front = -Math.PI / 2;
    for (let i = 0; i < 5; i++) {
      const s = spinToFront(i, front, 0);
      expect(Math.abs(s)).toBeLessThanOrEqual(Math.PI + 1e-9);
      const at = sliceMid(i) + s;
      expect(Math.cos(at - front)).toBeCloseTo(1, 9);
    }
    expect(Math.abs(spinToFront(2, front, 10) - 10)).toBeLessThanOrEqual(Math.PI + 1e-9);
  });

  it("reads empty as no evidence and signs the mean", () => {
    expect(sliceReadout({ mean_polarity: null, n_items: 0, n_sources: 0 })).toEqual({ mean: "no evidence", count: "N 0" });
    expect(sliceReadout({ mean_polarity: -0.33, n_items: 3, n_sources: 2 })).toEqual({ mean: "−0.33", count: "3 items, 2 source types" });
    expect(sliceReadout({ mean_polarity: 0, n_items: 1, n_sources: 1 }).mean).toBe("0.00");
    expect(sliceReadout({ mean_polarity: 1.5, n_items: 1, n_sources: 1 })).toEqual({ mean: "+1.50", count: "1 item, 1 source type" });
  });
});
