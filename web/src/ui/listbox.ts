/** Move a highlight along a menu in the same order as its labels. */
export function stepIndex(index: number, key: string, length: number): number | null {
  if (length <= 0) return null;
  const i = Number.isFinite(index) ? Math.max(0, Math.min(length - 1, index)) : 0;
  if (key === "ArrowDown") return Math.min(length - 1, i + 1);
  if (key === "ArrowUp") return Math.max(0, i - 1);
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}
