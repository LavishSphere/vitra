import { describe, expect, it } from "vitest";
import {
  GAP_TITLE,
  gapCountLabel,
  gapEmptyLine,
  gapFocus,
  gapIntro,
  gapIsFocused,
  gapRowName,
  missingCellMessage,
  rangeQuoteLabel,
} from "./gapFocus.ts";

const weeks = ["2025-W01", "2025-W02", "2025-W03", "2025-W04", "2025-W05"];

describe("gap focus", () => {
  it("sets product, speaker, and aspect, and the recent window", () => {
    const patch = gapFocus(
      { product: "B", speaker: "payer", aspect: "access_cost", window_weeks: 2 },
      weeks,
    );
    expect(patch).toEqual({
      product: "B",
      speaker: "payer",
      aspect: "access_cost",
      source: "all",
      signalType: "all",
      weekFrom: "2025-W04",
      weekTo: "2025-W05",
    });
  });

  it("maps a both-product gap onto the all filter and clamps a long window", () => {
    const patch = gapFocus(
      { product: "both", speaker: "hcp", aspect: "safety", window_weeks: 8 },
      weeks,
    );
    expect(patch.product).toBe("all");
    expect(patch.weekFrom).toBe("2025-W01");
    expect(patch.weekTo).toBe("2025-W05");
  });

  it("leaves the week range alone when no weeks are loaded", () => {
    const patch = gapFocus(
      { product: "A", speaker: "patient", aspect: "convenience", window_weeks: 8 },
      [],
    );
    expect(patch.weekFrom).toBeUndefined();
    expect(patch.weekTo).toBeUndefined();
    expect(patch.speaker).toBe("patient");
  });
});

describe("empty cells stay missing", () => {
  it("labels a zero count as missing", () => {
    expect(gapCountLabel(0)).toBe("missing");
    expect(gapCountLabel(-1)).toBe("missing");
    expect(gapCountLabel(0)).not.toBe("0");
    expect(gapCountLabel(0).toLowerCase()).not.toContain("neutral");
    expect(gapCountLabel(3)).toBe("3");
  });

  it("uses Where's the gap language without calling empty neutral", () => {
    expect(GAP_TITLE).toBe("Where's the gap");
    const intro = gapIntro(8);
    expect(intro).toContain("last 8 ISO weeks");
    expect(intro.toLowerCase()).toContain("missing evidence");
    expect(intro.toLowerCase()).not.toContain("neutral");
    expect(intro).not.toMatch(/[\u2013\u2014]/);
    expect(gapEmptyLine("A")).toContain("evidence");
    expect(gapEmptyLine("all").toLowerCase()).not.toContain("neutral");
  });

  it("names a row as a focus action", () => {
    const name = gapRowName("Tagrisso", "Patient", "convenience", 0, 8);
    expect(name).toContain("Missing");
    expect(name).toContain("Focus this cell");
    expect(name.toLowerCase()).not.toContain("neutral");
  });

  it("tells the scene an empty focused cell is missing evidence", () => {
    expect(missingCellMessage(0, { speaker: "payer", aspect: "access_cost" })).toContain("Missing evidence");
    expect(missingCellMessage(2, { speaker: "payer", aspect: "access_cost" })).toBeNull();
    expect(missingCellMessage(0, { speaker: "all", aspect: "access_cost" })).toBeNull();
    expect(rangeQuoteLabel(0)).toBe("no quotes in range");
    expect(rangeQuoteLabel(4)).toBe("4 items with quotes");
  });

  it("matches the focused row to the filters the click writes", () => {
    const gap = { product: "B" as const, speaker: "payer" as const, aspect: "access_cost" as const };
    const patch = gapFocus({ ...gap, window_weeks: 8 }, weeks);
    expect(gapIsFocused(patch, gap)).toBe(true);
    expect(gapIsFocused({ product: "all", speaker: "payer", aspect: "access_cost" }, gap)).toBe(false);
  });
});
