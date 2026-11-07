import { describe, expect, it } from "vitest";
import type { EvidenceGap } from "@contract/types.ts";
import { EXPECTED_VOICES } from "../data/gaps.ts";
import { abGapRows, abSideLabel } from "./abGaps.ts";

const gap = (product: "A" | "B", speaker: EvidenceGap["speaker"], aspect: EvidenceGap["aspect"]): EvidenceGap => ({
  product,
  speaker,
  aspect,
  window_weeks: 8,
  n_items_in_window: 0,
  last_seen_week: null,
});

describe("abGapRows", () => {
  it("marks A missing and B covered when only A has a gap row", () => {
    const rows = abGapRows(
      [gap("A", "payer", "access_cost")],
      [{ speaker: "payer", aspect: "access_cost" }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].a).toBe("missing");
    expect(rows[0].b).toBe("present");
    expect(rows[0].gapA?.product).toBe("A");
    expect(rows[0].gapB).toBeNull();
  });

  it("builds one row per expected voice", () => {
    const rows = abGapRows([], EXPECTED_VOICES);
    expect(rows).toHaveLength(EXPECTED_VOICES.length);
    expect(rows.every((r) => r.a === "present" && r.b === "present")).toBe(true);
  });

  it("labels sides for the table", () => {
    expect(abSideLabel("missing")).toBe("missing");
    expect(abSideLabel("present")).toBe("covered");
  });
});
