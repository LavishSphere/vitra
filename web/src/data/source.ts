import type { EvidenceGap, EvidenceItem, InsightCard, IntakeResult, Product, TrendCell } from "@contract/types.ts";

export interface Dataset {
  evidence: EvidenceItem[];
  trends: TrendCell[];
  cards: InsightCard[];
  gaps: EvidenceGap[];
}

export interface IntakeRequest { text: string; title?: string; product?: Product; }

export interface DataSource {
  kind: "fixtures" | "api";
  /** Shown in the UI so nobody mistakes synthetic data for real data. */
  label: string;
  load(): Promise<Dataset>;
  /** Full item (list endpoints may truncate text). */
  item(id: string): Promise<EvidenceItem | null>;
  /** Recompute trends (and cards where supported) for an exclusion set. */
  whatIf(excluded: string[], evidence: EvidenceItem[]): Promise<{ trends: TrendCell[]; cards?: InsightCard[]; gaps?: EvidenceGap[] }>;
  intake(req: IntakeRequest): Promise<IntakeResult>;
  /** Drop held transcripts on the source side ("Reset to source data"). */
  reset(): Promise<void>;
  /** A synthetic sample transcript for the intake panel, if this source has one. */
  sampleTranscript(): Promise<{ title: string; text: string; product: Product } | null>;
}
