/** Fixture data source: SYNTHETIC demo data bundled in src/fixtures. No network. */
import type { EvidenceItem, EvidenceGap, InsightCard, IntakeResult, Product } from "@contract/types.ts";
import evidenceJson from "../fixtures/evidence.json";
import cardsJson from "../fixtures/cards.json";
import gapsJson from "../fixtures/gaps.json";
import intakeJson from "../fixtures/intake.json";
import type { DataSource, IntakeRequest } from "./source.ts";
import { computeTrends } from "./trends.ts";
import { computeGaps } from "./gaps.ts";
import { spanIsVerified } from "./spans.ts";

const evidence = evidenceJson as EvidenceItem[];
const sample = intakeJson as unknown as IntakeResult & { transcript: { title: string; text: string; product: Product } };

const now = () => performance.now();

export const fixtureSource: DataSource = {
  kind: "fixtures",
  label: "Synthetic demo data",
  async load() {
    return {
      evidence: structuredClone(evidence),
      // Same as fixtures/trends.json (a test asserts it), computed here to keep the bundle small.
      trends: computeTrends(evidence),
      cards: cardsJson as InsightCard[],
      gaps: gapsJson as EvidenceGap[],
    };
  },
  async item(id) {
    return evidence.find((e) => e.item_id === id) ?? null;
  },
  async whatIf(excluded, all) {
    const set = new Set(excluded);
    return { trends: computeTrends(all, set), gaps: computeGaps(all, set, 8) };
  },
  /**
   * Fixture mode has no classifier. For the stored synthetic sample it returns the stored
   * result and really runs quote validation. Any other text gets an honest error.
   */
  async intake(req: IntakeRequest): Promise<IntakeResult> {
    const t0 = now();
    const received = Math.max(0, Math.round(now() - t0));
    if (req.text.trim() !== sample.transcript.text.trim()) {
      return {
        status: "error",
        stages: [{ name: "received_locally", ms: received }],
        evidence: null,
        rejected_spans: [],
        reason: null,
        error: "The classifier runs only in API mode. Fixture mode can replay the stored synthetic sample.",
      };
    }
    const ev = structuredClone(sample.evidence!) as EvidenceItem;
    const t1 = now();
    const kept = ev.aspects.filter((a) => spanIsVerified(req.text.trim(), a));
    const validating = now() - t1;
    ev.aspects = kept;
    return {
      status: kept.length ? "complete" : "abstained",
      stages: [
        { name: "received_locally", ms: received },
        { name: "classifying", ms: 0 },
        { name: "validating_quotes", ms: Math.round(validating * 100) / 100 },
      ],
      evidence: kept.length ? ev : null,
      rejected_spans: sample.rejected_spans,
      reason: kept.length ? null : "No quote in the text matched the stored result.",
      error: null,
    };
  },
  async reset() {
    // Nothing is held outside the store in fixture mode.
  },
  async sampleTranscript() {
    return sample.transcript;
  },
};
