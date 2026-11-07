/** Fixture data source: SYNTHETIC demo data bundled in src/fixtures. No network. */
import type { EvidenceItem, EvidenceGap, InsightCard, IntakeResult } from "@contract/types.ts";
import evidenceJson from "../fixtures/evidence.json";
import cardsJson from "../fixtures/cards.json";
import gapsJson from "../fixtures/gaps.json";
import type { DataSource, IntakeRequest } from "./source.ts";
import { computeTrends } from "./trends.ts";
import { computeGaps } from "./gaps.ts";
import { spanIsVerified } from "./spans.ts";
import { RECORDED, isRecordedNote, recordedEvidence, sampleNote } from "./recorded.ts";

const evidence = evidenceJson as EvidenceItem[];

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
  cardsLive: false,
  /**
   * Fixture mode has no classifier. For the sample note it replays the recorded local-model
   * result (stage time as recorded) and really runs quote validation. Any other text gets an
   * honest error.
   */
  async intake(req: IntakeRequest): Promise<IntakeResult> {
    const t0 = now();
    const text = req.text.trim();
    const received = Math.round((now() - t0) * 100) / 100;
    if (!isRecordedNote(text)) {
      return {
        status: "error",
        stages: [{ name: "received_locally", ms: received }],
        evidence: null,
        rejected_spans: [],
        reason: null,
        error: "This page can only replay the sample note. The model runs on the laptop build, so other text isn't classified here.",
      };
    }
    const { evidence: ev, rejected } = recordedEvidence(text);
    const t1 = now();
    ev.aspects = ev.aspects.filter((a) => spanIsVerified(text, a));
    const validating = Math.round((now() - t1) * 100) / 100;
    const kept = ev.aspects.length > 0;
    return {
      status: kept ? "complete" : "abstained",
      stages: [
        { name: "received_locally", ms: received },
        { name: "classifying", ms: RECORDED.recorded_stages_ms.classifying },
        { name: "validating_quotes", ms: validating },
      ],
      evidence: kept ? ev : null,
      rejected_spans: rejected,
      reason: kept ? null : "No quote in the text matched the recorded result.",
      error: null,
    };
  },
  async undo() {
    // Nothing is held outside the store in fixture mode. The store restores its snapshot.
  },
  async reset() {
    // Nothing is held outside the store in fixture mode.
  },
  async sampleTranscript() {
    return sampleNote();
  },
};
