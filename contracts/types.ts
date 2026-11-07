// Vitra data contract v1.2. Mirrors contracts/CONTRACT.md. Keep in sync.

export type Product = "A" | "B" | "both";
export type Source =
  | "pubmed" | "ctgov" | "fda_event" | "fda_label" | "fda_notice" | "press_release" | "news"
  | "transcript";
export type SignalType =
  | "efficacy" | "safety" | "regulatory" | "trial_update" | "competitor_move"
  | "access_pricing" | "guideline" | "expert_opinion" | "none";
export type AspectKey = "efficacy" | "safety" | "convenience" | "access_cost" | "evidence_quality";
export type Speaker = "researcher" | "hcp" | "patient" | "company" | "regulator" | "payer" | "media";
export type Polarity = -2 | -1 | 0 | 1 | 2;
export type Origin = "gold_dev" | "predicted" | "rule" | "private_transcript" | "synthetic_demo";

export const ASPECTS: AspectKey[] = ["efficacy", "safety", "convenience", "access_cost", "evidence_quality"];
export const SPEAKERS: Speaker[] = ["researcher", "hcp", "patient", "company", "regulator", "payer", "media"];

export interface AspectEvidence {
  aspect: AspectKey;
  polarity: Polarity;
  speaker: Speaker;
  span: string;
  span_start: number;
  span_end: number;
}

export interface Confidence {
  level: "high" | "medium" | "low";
  method: "rule" | "model" | "mixed" | "gold";
  span_verified: boolean;
  source_authority: "regulator" | "registry" | "peer_reviewed" | "company" | "news" | "private";
  corroborating_items: number;
  notes: string[];
}

export interface EvidenceItem {
  item_id: string;
  source: Source;
  url: string;
  published: string; // YYYY-MM-DD
  iso_week: string; // YYYY-Www
  product: Product;
  title: string;
  text: string;
  signal_type: SignalType;
  actionable: "yes" | "no";
  origin: Origin;
  aspects: AspectEvidence[];
  confidence: Confidence;
}

export interface TrendCell {
  week: string;
  product: Product;
  speaker: Speaker | "all";
  aspect: AspectKey | "all";
  mean_polarity: number | null; // null = no data, never 0
  n_items: number;
  n_sources: number;
  item_ids: string[];
}

export interface Citation {
  item_id: string;
  aspect: AspectKey;
  span: string;
  url: string;
  span_start: number;
  span_end: number;
}

export interface InsightCard {
  id: string;
  headline: string;
  signal_type: SignalType;
  product: Product;
  week: string;
  actionable: boolean;
  why_it_matters: string;
  citations: Citation[];
  confidence: Confidence;
  fact: string;
  observed_sentiment: string;
  interpretation: string;
}

export interface EvidenceGap {
  product: Product;
  speaker: Speaker;
  aspect: AspectKey;
  window_weeks: number;
  n_items_in_window: number;
  last_seen_week: string | null;
}

export type IntakeStageName = "received_locally" | "classifying" | "validating_quotes" | "incorporating";
export interface IntakeResult {
  status: "complete" | "abstained" | "error";
  stages: { name: IntakeStageName; ms: number }[];
  evidence: EvidenceItem | null;
  rejected_spans: { aspect: AspectKey; span: string; reason: string }[];
  reason: string | null;
  error: string | null;
}

// DELETE /api/intake/{item_id} (v1.2). item_id is IntakeResult.evidence.item_id.
// Unknown id: HTTP 404 with { detail: "no held transcript with that id" }.
export interface IntakeUndoResult {
  ok: true;
  removed: string;
  trends_changed: boolean;
}
