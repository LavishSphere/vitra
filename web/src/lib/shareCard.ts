/**
 * Render one insight card to a PNG for the pitch deck / Devpost.
 * Canvas only (no network, no extra dependency). Quote is the first citation span.
 */
import type { InsightCard } from "@contract/types.ts";

const W = 960;
const PAD = 48;
const BG = "#0a0e17";
const BORDER = "#232b3a";
const TEXT = "#f1f5f9";
const MUTED = "#7c8aa5";
const ACCENT = "#818cf8";

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function productLabel(p: InsightCard["product"]): string {
  if (p === "A") return "Tagrisso (A)";
  if (p === "B") return "Rybrevant / Lazcluze (B)";
  return "Tagrisso and Rybrevant (both)";
}

/** Build a PNG blob for one insight card. Uses the first citation span as the quote. */
export async function insightCardPng(card: InsightCard): Promise<Blob> {
  const quote = card.citations[0]?.span?.trim() || card.fact;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, canvas.height);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, W - 48, canvas.height - 48);

  let y = PAD + 16;
  ctx.fillStyle = ACCENT;
  ctx.font = "600 22px Geist, ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Vitra", PAD, y);

  y += 36;
  ctx.fillStyle = MUTED;
  ctx.font = "500 18px Geist, ui-sans-serif, system-ui, sans-serif";
  const meta = `${productLabel(card.product)}  ·  ${card.week}  ·  ${card.signal_type.replaceAll("_", " ")}`;
  ctx.fillText(meta, PAD, y);

  y += 48;
  ctx.fillStyle = TEXT;
  ctx.font = "600 32px Geist, ui-sans-serif, system-ui, sans-serif";
  for (const line of wrap(ctx, card.headline, W - PAD * 2).slice(0, 3)) {
    ctx.fillText(line, PAD, y);
    y += 40;
  }

  y += 20;
  ctx.fillStyle = MUTED;
  ctx.font = "500 16px Geist, ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Quote (exact span)", PAD, y);
  y += 28;
  ctx.fillStyle = TEXT;
  ctx.font = "italic 22px \"Instrument Serif\", Georgia, serif";
  const qLines = wrap(ctx, `"${quote}"`, W - PAD * 2).slice(0, 5);
  for (const line of qLines) {
    ctx.fillText(line, PAD, y);
    y += 32;
  }

  y = canvas.height - PAD;
  ctx.fillStyle = MUTED;
  ctx.font = "500 14px Geist Mono, ui-monospace, monospace";
  ctx.fillText("Illustrative insight card. Not clinical advice.", PAD, y);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("png encode failed");
  return blob;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}

export function shareFilename(card: InsightCard): string {
  const safe = card.id.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 48);
  return `vitra-insight-${safe || "card"}.png`;
}
