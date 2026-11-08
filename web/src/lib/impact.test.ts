import { describe, expect, it } from "vitest";
import type { EvidenceItem, InsightCard } from "@contract/types.ts";
import evidenceJson from "../fixtures/evidence.json";
import cardsJson from "../fixtures/cards.json";
import { computeTrends } from "../data/trends.ts";
import { computeGaps } from "../data/gaps.ts";
import { recordedEvidence, sampleNote } from "../data/recorded.ts";
import { diffCards, diffImpact, impactSummary, type Snapshot } from "./impact.ts";

const base = evidenceJson as EvidenceItem[];
const cards = cardsJson as InsightCard[];

const snap = (evidence: EvidenceItem[]): Snapshot => ({
  evidence, trends: computeTrends(evidence), cards, gaps: computeGaps(evidence, new Set(), 8),
});

describe("diffImpact", () => {
  it("reports nothing when before and after are the same", () => {
    const s = snap(base);
    const i = diffImpact(s, snap(structuredClone(base)));
    expect(i.empty).toBe(true);
    expect(impactSummary(i)).toMatch(/^Nothing changed/);
  });

  it("finds the cells and the gap the recorded sample note changes", () => {
    const { evidence: note } = recordedEvidence(sampleNote().text);
    const i = diffImpact(snap(base), snap([...base, note]));
    const cells = i.cells.map((c) => `${c.product} ${c.speaker} ${c.aspect} ${c.week} ${c.meanBefore}->${c.meanAfter} N${c.nBefore}->${c.nAfter}`);
    expect(cells).toEqual([
      "B hcp convenience 2025-W43 null->1 N0->1",
      "B hcp safety 2025-W43 null->-1 N0->1",
      "B payer access_cost 2025-W43 null->-1 N0->1",
    ]);
    for (const c of i.cells) expect(c.added).toEqual(["SYN-T002"]);
    // Payers on access and clinicians on safety were last heard outside the 8-week window.
    expect(i.gapsClosed.map((g) => `${g.product} ${g.speaker} ${g.aspect}`)).toEqual(["B payer access_cost", "B hcp safety"]);
    expect(i.gapsOpened).toEqual([]);
    expect(impactSummary(i)).toBe("3 trend cells changed, 2 evidence gaps closed.");
  });

  it("averages into an existing cell instead of replacing it", () => {
    const into = base.find((e) => e.product === "B" && e.aspects.some((a) => a.speaker === "hcp" && a.aspect === "safety"))!;
    const extra: EvidenceItem = structuredClone(into);
    extra.item_id = "SYN-X999";
    extra.aspects = extra.aspects.filter((a) => a.aspect === "safety" && a.speaker === "hcp").map((a) => ({ ...a, polarity: 1 }));
    const i = diffImpact(snap(base), snap([...base, extra]));
    const cell = i.cells.find((c) => c.aspect === "safety" && c.speaker === "hcp" && c.week === into.iso_week)!;
    expect(cell.nBefore).toBeGreaterThan(0);
    expect(cell.nAfter).toBe(cell.nBefore + 1);
    expect(cell.meanBefore).not.toBe(cell.meanAfter);
  });
});

describe("diffCards", () => {
  it("separates new, changed and removed cards", () => {
    const [a, b, c] = cards;
    const b2 = { ...b, confidence: { ...b.confidence, corroborating_items: b.confidence.corroborating_items + 1 } };
    const d = { ...a, id: "card-new" };
    const out = diffCards([a, b, c], [a, b2, d]);
    expect(out.map((x) => `${x.kind}:${x.id}`)).toEqual([`changed:${b.id}`, "new:card-new", `removed:${c.id}`]);
    expect(out[0].fields).toEqual(["confidence"]);
  });
});
