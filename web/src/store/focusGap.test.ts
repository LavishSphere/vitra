import { afterEach, describe, expect, it } from "vitest";
import type { EvidenceGap } from "@contract/types.ts";
import { useVitra, type Filters } from "./useVitra.ts";

const weeks = ["2025-W01", "2025-W02", "2025-W03", "2025-W04"];

const baseFilters = (): Filters => ({
  product: "all",
  weekFrom: weeks[0],
  weekTo: weeks[weeks.length - 1],
  speaker: "all",
  aspect: "all",
  source: "pubmed",
  signalType: "safety",
});

const gap: EvidenceGap = {
  product: "B",
  speaker: "payer",
  aspect: "access_cost",
  window_weeks: 2,
  n_items_in_window: 0,
  last_seen_week: "2025-W01",
};

afterEach(() => {
  useVitra.setState({
    evidence: [],
    weeks: [],
    marks: [],
    excluded: [],
    filters: baseFilters(),
    focusStation: null,
    focusTumor: false,
    tumorCardOpen: false,
    selection: null,
    railTab: "trends",
  });
});

describe("focusGap", () => {
  it("writes the cell filters, flies to the station, and stays on the gaps tab", () => {
    useVitra.setState({
      evidence: [],
      weeks,
      marks: [],
      excluded: [],
      filters: { ...baseFilters(), weekFrom: weeks[0], weekTo: weeks[3] },
      focusStation: null,
      focusTumor: true,
      selection: { itemId: "syn-1", aspect: "efficacy" },
      railTab: "gaps",
    });

    useVitra.getState().focusGap(gap);
    const s = useVitra.getState();

    expect(s.filters.product).toBe("B");
    expect(s.filters.speaker).toBe("payer");
    expect(s.filters.aspect).toBe("access_cost");
    expect(s.filters.source).toBe("all");
    expect(s.filters.signalType).toBe("all");
    expect(s.filters.weekFrom).toBe("2025-W03");
    expect(s.filters.weekTo).toBe("2025-W04");
    expect(s.focusStation).toBe("access");
    expect(s.focusTumor).toBe(false);
    expect(s.selection).toBeNull();
    expect(s.railTab).toBe("gaps");
  });
});
