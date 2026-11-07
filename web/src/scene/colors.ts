/** Reads the CSS design tokens so three.js uses the same values as the UI. */
import { Color } from "three";

function cssVar(name: string): string {
  if (typeof document === "undefined") return "#ffffff";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#ffffff";
}

export interface Theme {
  ink: Color; ink2: Color; cyan: Color; blue: Color; magenta: Color; ivory: Color; muted: Color; accent: Color;
}

let cached: Theme | null = null;
export function theme(): Theme {
  if (cached) return cached;
  cached = {
    ink: new Color(cssVar("--color-ink")),
    ink2: new Color(cssVar("--color-ink-2")),
    cyan: new Color(cssVar("--color-cyan")),
    blue: new Color(cssVar("--color-blue")),
    magenta: new Color(cssVar("--color-magenta")),
    ivory: new Color(cssVar("--color-ivory")),
    muted: new Color(cssVar("--color-muted")),
    accent: new Color(cssVar("--color-accent")),
  };
  return cached;
}

/** Polarity ramp magenta(-2) -> muted(0) -> cyan(+2). Writes into `out`, no allocation. */
export function polarityColor(p: number, out: Color): Color {
  const t = theme();
  const k = Math.max(-2, Math.min(2, p)) / 2;
  if (k < 0) return out.copy(t.muted).lerp(t.magenta, -k);
  return out.copy(t.muted).lerp(t.cyan, k);
}
