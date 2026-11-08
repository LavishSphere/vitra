/**
 * Station cards group quotes so a thousand of them stay readable: one dot per
 * (station, time column, polarity), sized by how many quotes share it.
 * Pasted transcript quotes keep their own dot so their landing stays visible.
 */
import type { Mark } from "../store/useVitra.ts";

/** Most time columns a station card draws. Fewer weeks than this keeps one column per week. */
export const MAX_COLUMNS = 24;

export interface Cell {
  key: string;
  col: number;
  polarity: number;
  /** The mark a click opens: the first one still counted, else the first one. */
  rep: Mark;
  members: Mark[];
  /** Members that are not excluded. */
  live: number;
}

export function columnCount(nWeeks: number, max = MAX_COLUMNS): number {
  return Math.max(1, Math.min(max, nWeeks));
}

export function columnOf(weekIndex: number, nWeeks: number, max = MAX_COLUMNS): number {
  const c = columnCount(nWeeks, max);
  if (nWeeks <= 1) return 0;
  return Math.min(c - 1, Math.floor((weekIndex * c) / nWeeks));
}

/** Column center as a fractional week index, for the same x mapping the weeks use. */
export function columnCenter(col: number, nWeeks: number, max = MAX_COLUMNS): number {
  const c = columnCount(nWeeks, max);
  if (c === nWeeks) return col;
  return ((col + 0.5) * nWeeks) / c - 0.5;
}

/** Dot size multiplier: 1 quote is 1, then grows slowly (8 quotes is 2), up to `cap`. */
export function cellScale(n: number, cap = 2.6): number {
  return Math.min(cap, 1 + Math.log2(Math.max(1, n)) / 3);
}

/** Groups the given marks into cells, in first-seen order. Callers pass the marks they draw. */
export function groupMarks(marks: Mark[], weeks: string[], max = MAX_COLUMNS): Cell[] {
  const weekIdx = new Map(weeks.map((w, i) => [w, i]));
  const n = weeks.length;
  const cells = new Map<string, Cell>();
  for (const m of marks) {
    const col = columnOf(weekIdx.get(m.item.iso_week) ?? 0, n, max);
    const own = m.item.source === "transcript" ? `|${m.key}` : "";
    const key = `${m.station}|${col}|${m.aspect.polarity}${own}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { key, col, polarity: m.aspect.polarity, rep: m, members: [], live: 0 };
      cells.set(key, cell);
    }
    cell.members.push(m);
    if (!m.excluded) {
      if (cell.live === 0) cell.rep = m;
      cell.live++;
    }
  }
  return [...cells.values()];
}
