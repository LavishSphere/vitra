/** CSS-side token helpers. Safe to import anywhere (no three.js). */
import type { Speaker } from "@contract/types.ts";

export const speakerVar = (s: Speaker | string) => `var(--color-sp-${s})`;

export function polarityCss(p: number | null): string {
  if (p === null) return "var(--color-muted)";
  const k = Math.max(-2, Math.min(2, p)) / 2;
  const pct = Math.round(Math.abs(k) * 100);
  return k < 0
    ? `color-mix(in oklab, var(--color-magenta) ${pct}%, var(--color-muted))`
    : `color-mix(in oklab, var(--color-cyan) ${pct}%, var(--color-muted))`;
}
