import type { Polarity } from "@contract/types.ts";

export function signedPolarity(p: number | null, digits = 0): string {
  if (p === null || Number.isNaN(p)) return "n/a";
  const v = digits ? p.toFixed(digits) : String(p);
  return p > 0 ? `+${v}` : p < 0 ? `−${v.replace("-", "")}` : v;
}

export const POLARITY_WORD: Record<Polarity, string> = {
  [-2]: "strongly negative",
  [-1]: "negative",
  [0]: "neutral",
  [1]: "positive",
  [2]: "strongly positive",
};

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function humanize(s: string): string {
  return s.replace(/_/g, " ");
}
