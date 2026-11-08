import { beforeAll, describe, expect, it, vi } from "vitest";
import { useVitra } from "./useVitra.ts";
import { fixtureSource } from "../data/fixtureSource.ts";
import { sampleNote } from "../data/recorded.ts";
import { computeTrends } from "../data/trends.ts";
import { computeGaps } from "../data/gaps.ts";

describe("intake undo", () => {
  beforeAll(async () => { await useVitra.getState().load(); });

  it("adds the sample note, reports what changed, then restores the baseline exactly", async () => {
    const base = structuredClone((({ evidence, trends, cards, gaps, weeks, filters, excluded }) => ({ evidence, trends, cards, gaps, weeks, filters, excluded }))(useVitra.getState()));
    const nMarks = useVitra.getState().marks.length;

    const result = await fixtureSource.intake({ text: sampleNote().text, product: "B" });
    expect(result.status).toBe("complete");
    expect(result.stages.find((s) => s.name === "classifying")?.ms).toBe(11653);
    await useVitra.getState().incorporate(result, { tour: false });

    const mid = useVitra.getState();
    expect(mid.session?.itemId).toBe("SYN-T002");
    expect(mid.session?.impact.empty).toBe(false);
    expect(mid.session?.impact.cells.length).toBe(3);
    expect(mid.session?.tour.map((t) => t.station).sort()).toEqual(["access", "administration", "living"]);
    expect(mid.marks.filter((m) => m.item.item_id === "SYN-T002").map((m) => m.station).sort()).toEqual(["access", "administration", "living"]);
    expect(mid.trends).not.toEqual(base.trends);
    expect(mid.gaps).not.toEqual(base.gaps);

    await useVitra.getState().undoIntake();
    const after = useVitra.getState();
    expect(after.session).toBeNull();
    expect(after.evidence).toEqual(base.evidence);
    expect(after.trends).toEqual(base.trends);
    expect(after.cards).toEqual(base.cards);
    expect(after.gaps).toEqual(base.gaps);
    expect(after.weeks).toEqual(base.weeks);
    expect(after.filters).toEqual(base.filters);
    expect(after.excluded).toEqual(base.excluded);
    expect(after.marks.filter((m) => m.item.item_id === "SYN-T002")).toEqual([]);
    expect(after.marks.length).toBe(nMarks);
    // The restored numbers are also what a fresh recompute gives.
    expect(after.trends).toEqual(computeTrends(after.evidence));
    expect(after.gaps).toEqual(computeGaps(after.evidence, new Set(), 8));
  });

  it("drops every pasted note and recomputes when the source can only reset", async () => {
    const baseEvidence = structuredClone(useVitra.getState().evidence);
    const first = await fixtureSource.intake({ text: sampleNote().text, product: "B" });
    await useVitra.getState().incorporate(first, { tour: false });
    useVitra.getState().dismissSession();
    const second = await fixtureSource.intake({ text: sampleNote().text, product: "B" });
    second.evidence!.item_id = "SYN-T003";
    await useVitra.getState().incorporate(second, { tour: false });
    expect(useVitra.getState().evidence.filter((e) => e.source === "transcript").length).toBe(2);

    const spy = vi.spyOn(fixtureSource, "undo").mockResolvedValue("all");
    expect(await useVitra.getState().undoIntake()).toBe("all");
    spy.mockRestore();
    const s = useVitra.getState();
    expect(s.evidence).toEqual(baseEvidence);
    expect(s.trends).toEqual(computeTrends(baseEvidence));
    expect(s.gaps).toEqual(computeGaps(baseEvidence, new Set(), 8));
    expect(s.marks.some((m) => m.item.source === "transcript")).toBe(false);
  });

  it("refuses to classify other text in fixture mode", async () => {
    const r = await fixtureSource.intake({ text: "Some other note about rash.", product: "B" });
    expect(r.status).toBe("error");
    expect(r.evidence).toBeNull();
  });
});
