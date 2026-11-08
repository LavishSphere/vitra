import { describe, expect, it } from "vitest";
import type { EvidenceItem } from "@contract/types.ts";
import evidenceJson from "../fixtures/evidence.json";
import {
  lungSafetyEvidence, lungSafetyHit, mentionsLungSafety, pinSpot, sentenceAround, splitOnTerm,
  type SurfaceSamples,
} from "./lungSafety.ts";

const evidence = evidenceJson as EvidenceItem[];

function item(over: Partial<EvidenceItem> & Pick<EvidenceItem, "item_id" | "text">): EvidenceItem {
  return {
    source: "news", url: "urn:test", published: "2025-07-01", iso_week: "2025-W27", product: "A", title: "t",
    signal_type: "safety", actionable: "no", origin: "synthetic_demo", aspects: [],
    confidence: { level: "low", method: "model", span_verified: true, source_authority: "news", corroborating_items: 0, notes: [] },
    ...over,
  };
}

function withSpan(id: string, text: string, span: string, polarity: -2 | -1 | 0 | 1 | 2, aspect: "safety" | "efficacy" = "safety"): EvidenceItem {
  const s = text.indexOf(span);
  return item({ item_id: id, text, aspects: [{ aspect, polarity, speaker: "hcp", span, span_start: s, span_end: s + span.length }] });
}

describe("mentionsLungSafety", () => {
  it("matches the four terms, any case, word-bounded", () => {
    expect(mentionsLungSafety("Grade 2 ILD was reported.")).toBe(true);
    expect(mentionsLungSafety("interstitial lung disease (ILD)/pneumonitis")).toBe(true);
    expect(mentionsLungSafety("Interstitial Lung Diseases were rare.")).toBe(true);
    expect(mentionsLungSafety("PNEUMONITIS")).toBe(true);
    expect(mentionsLungSafety("no lung toxicity seen")).toBe(true);
    expect(mentionsLungSafety("lung toxicities")).toBe(true);
  });
  it("ignores look-alikes", () => {
    expect(mentionsLungSafety("a mild rash")).toBe(false);
    expect(mentionsLungSafety("BUILD a child cohort")).toBe(false);
    expect(mentionsLungSafety("pneumonia")).toBe(false);
    expect(mentionsLungSafety("new respiratory symptoms")).toBe(false);
    expect(mentionsLungSafety("lung cancer")).toBe(false);
  });
});

describe("lungSafetyHit", () => {
  it("takes the verified span and its polarity", () => {
    const h = lungSafetyHit(withSpan("X1", "Intro. A doctor reported pneumonitis on drug. End.", "A doctor reported pneumonitis on drug.", -2))!;
    expect(h.quoteKind).toBe("span");
    expect(h.polarity).toBe(-2);
    expect(h.aspect).toBe("safety");
    expect(h.term).toBe("pneumonitis");
  });

  it("ignores a span that does not verify, and falls back to the text with no polarity", () => {
    const it = withSpan("X2", "Intro. A doctor reported pneumonitis on drug. End.", "A doctor reported pneumonitis on drug.", -2);
    it.aspects[0].span_start += 1;
    it.aspects[0].span_end += 1;
    const h = lungSafetyHit(it)!;
    expect(h.quoteKind).toBe("text");
    expect(h.polarity).toBeNull();
    expect(h.aspect).toBeNull();
    expect(it.text.includes(h.quote)).toBe(true);
  });

  it("never borrows another aspect's polarity for a text-only match", () => {
    const h = lungSafetyHit(withSpan("X3", "People with ILD were excluded. Rash was common.", "Rash was common.", -1))!;
    expect(h.quoteKind).toBe("text");
    expect(h.polarity).toBeNull();
    expect(h.quote).toBe("People with ILD were excluded.");
  });

  it("returns null when nothing mentions it", () => {
    expect(lungSafetyHit(item({ item_id: "X4", text: "Rash was common." }))).toBeNull();
  });
});

describe("sentenceAround and splitOnTerm", () => {
  it("returns an exact substring holding the index", () => {
    const t = "One. Two has ILD in it! Three.";
    const s = sentenceAround(t, t.indexOf("ILD"));
    expect(s).toBe("Two has ILD in it!");
    expect(t.includes(s)).toBe(true);
  });
  it("splits around the term", () => {
    expect(splitOnTerm("No new cases of ILD after cutoff.")).toEqual({ before: "No new cases of ", term: "ILD", after: " after cutoff." });
  });
});

describe("lungSafetyEvidence on the synthetic fixtures", () => {
  it("finds the four seeded mentions, each quote an exact substring", () => {
    const hits = lungSafetyEvidence(evidence);
    expect(hits.map((h) => h.item.item_id)).toEqual(["SYN-0047", "SYN-0048", "SYN-0049", "SYN-0050"]);
    for (const h of hits) expect(h.item.text.includes(h.quote)).toBe(true);
    expect(hits.map((h) => h.polarity)).toEqual([-2, -1, 1, null]);
  });

  it("respects the product and week filters", () => {
    expect(lungSafetyEvidence(evidence, { product: "B", weekFrom: "", weekTo: "" }).map((h) => h.item.item_id)).toEqual(["SYN-0048"]);
    expect(lungSafetyEvidence(evidence, { product: "all", weekFrom: "2025-W36", weekTo: "2025-W43" }).map((h) => h.item.item_id)).toEqual(["SYN-0049", "SYN-0050"]);
  });
});

describe("pinSpot", () => {
  // A unit sphere sampled on a grid stands in for the lung surface.
  const surface: SurfaceSamples = (() => {
    const pos: number[] = [];
    for (let i = 0; i < 40; i++) for (let j = 0; j < 80; j++) {
      const th = (i + 0.5) / 40 * Math.PI;
      const ph = j / 80 * Math.PI * 2;
      pos.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    }
    return { positions: pos, normals: pos, count: pos.length / 3 };
  })();

  it("depends only on the item_id", () => {
    expect(pinSpot("SYN-0047", surface)).toEqual(pinSpot("SYN-0047", surface));
    expect(pinSpot("SYN-0047", surface)).not.toEqual(pinSpot("SYN-0048", surface));
  });

  it("lands on a surface sample that faces the camera and avoids the tumor", () => {
    const avoid = { x: 0, y: 0, z: 1, radius: 0.5 };
    for (let k = 0; k < 50; k++) {
      const p = pinSpot(`ID-${k}`, surface, { avoid });
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 5);
      expect(p.nz).toBeGreaterThanOrEqual(0.15);
      expect(Math.hypot(p.x, p.y, p.z - 1)).toBeGreaterThanOrEqual(0.5);
    }
  });
});
