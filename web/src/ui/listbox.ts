function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(length - 1, index));
}

/** Move a highlight along a menu in the same order as its labels. */
export function stepIndex(index: number, key: string, length: number): number | null {
  if (length <= 0) return null;
  const i = clampIndex(index, length);
  if (key === "ArrowDown") return Math.min(length - 1, i + 1);
  if (key === "ArrowUp") return Math.max(0, i - 1);
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}

/**
 * The key that opens a closed menu stays on the current row.
 * The next ArrowDown or ArrowUp then walks one label.
 */
export function openHighlight(selected: number, key: string, length: number): number | null {
  if (length <= 0) return null;
  if (key === "ArrowDown" || key === "ArrowUp") return clampIndex(selected, length);
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}
