import { describe, expect, it } from "vitest";
import type { Mark } from "../store/useVitra.ts";
import { cellScale, columnCenter, columnOf, groupMarks } from "./cells.ts";

function mark(i: number, week: string, polarity: number, extra: { source?: string; excluded?: boolean; station?: string } = {}): Mark {
  return {
    index: i,
    key: `I${i}:safety`,
    item: { item_id: `I${i}`, iso_week: week, source: extra.source ?? "fda_event" },
    aspect: { aspect: "safety", polarity },
    station: extra.station ?? "living",
    visible: true,
    excluded: extra.excluded ?? false,
  } as unknown as Mark;
}

const weeks = Array.from({ length: 96 }, (_, i) => `W${String(i).padStart(2, "0")}`);

describe("station cells", () => {
  it("keeps one column per week when there are few weeks", () => {
    expect(columnOf(5, 10)).toBe(5);
    expect(columnCenter(5, 10)).toBe(5);
  });

  it("folds many weeks into at most 24 columns", () => {
    expect(columnOf(0, 96)).toBe(0);
    expect(columnOf(95, 96)).toBe(23);
    expect(columnOf(3, 96)).toBe(0);
    expect(columnOf(4, 96)).toBe(1);
    expect(columnCenter(0, 96)).toBeCloseTo(1.5);
  });

  it("groups same column and polarity into one dot, sized by count", () => {
    const marks = [mark(0, "W00", -1), mark(1, "W01", -1), mark(2, "W02", -1), mark(3, "W02", 1)];
    const cells = groupMarks(marks, weeks);
    expect(cells).toHaveLength(2);
    expect(cells[0].members).toHaveLength(3);
    expect(cellScale(1)).toBe(1);
    expect(cellScale(8)).toBe(2);
    expect(cellScale(10_000)).toBe(2.6);
  });

  it("opens a counted quote first and never merges pasted transcripts", () => {
    const marks = [mark(0, "W00", -1, { excluded: true }), mark(1, "W00", -1), mark(2, "W00", -1, { source: "transcript" })];
    const cells = groupMarks(marks, weeks);
    expect(cells).toHaveLength(2);
    expect(cells[0].rep.index).toBe(1);
    expect(cells[0].live).toBe(1);
    expect(cells[1].members.map((m) => m.index)).toEqual([2]);
  });
});
