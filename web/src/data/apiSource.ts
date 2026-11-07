/** API data source: the local backend (contract section 8). Loopback only. */
import { ASPECTS, SPEAKERS, type EvidenceGap, type EvidenceItem, type InsightCard, type IntakeResult, type TrendCell } from "@contract/types.ts";
import type { DataSource } from "./source.ts";
import { TOKEN } from "./token.ts";
import intakeJson from "../fixtures/intake.json";

/** Dev server talks to the API on :8000. A built bundle is served by the API, so same origin. */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? (import.meta.env.DEV ? "http://127.0.0.1:8000" : "");

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Vitra-Token": TOKEN, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

// The UI draws per-speaker, per-aspect series. Asking for exactly those keeps the grid small.
const TREND_FILTER = { product: "A,B,both", aspect: ASPECTS.join(","), speaker: SPEAKERS.join(",") };
const trendQuery = new URLSearchParams(TREND_FILTER).toString();

export const apiSource: DataSource = {
  kind: "api",
  label: "Local API",
  async load() {
    const [evidence, trends, cards, gaps] = await Promise.all([
      call<EvidenceItem[]>("/api/evidence"),
      call<TrendCell[]>(`/api/trends?${trendQuery}`),
      call<InsightCard[]>("/api/insights"),
      call<EvidenceGap[]>("/api/gaps?window_weeks=8"),
    ]);
    return { evidence, trends, cards, gaps };
  },
  async item(id) {
    try { return await call<EvidenceItem>(`/api/evidence/${encodeURIComponent(id)}`); } catch { return null; }
  },
  async whatIf(excluded) {
    const [r, gaps] = await Promise.all([
      call<{ trends: TrendCell[]; insights: InsightCard[] }>("/api/whatif", {
        method: "POST", body: JSON.stringify({ excluded_ids: excluded, ...TREND_FILTER }),
      }),
      call<EvidenceGap[]>(`/api/gaps?window_weeks=8&excluded=${encodeURIComponent(excluded.join(","))}`),
    ]);
    return { trends: r.trends, cards: r.insights, gaps };
  },
  async intake(req) {
    return call<IntakeResult>("/api/intake", { method: "POST", body: JSON.stringify(req) });
  },
  async reset() {
    await call<{ transcripts_cleared: number }>("/api/reset", { method: "POST" });
  },
  async sampleTranscript() {
    // The same SYNTHETIC sample as fixture mode, so a judge always has something to paste.
    return (intakeJson as { transcript: { title: string; text: string; product: "A" | "B" } }).transcript;
  },
};
