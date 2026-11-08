/**
 * The recorded intake result for the sample note. It is a real output of the local pipeline
 * (Llama 3.2 3B, transcript policy) captured on a laptop. The public page replays
 * it and says so. Offsets come from indexOf on the note text, then the usual span check.
 */
import { ASPECTS, type AspectEvidence, type AspectKey, type EvidenceItem, type Polarity, type Product, type SignalType, type Speaker } from "@contract/types.ts";
import recordedJson from "../fixtures/recorded-intake.json";
import { isoWeekOf } from "../lib/isoWeek.ts";

/** Organizer prediction format (contract section 1). */
type Prediction = { item_id: string; signal_type: SignalType; actionable: "yes" | "no" } &
  Record<AspectKey, { polarity: Polarity; speaker: Speaker; span: string } | null>;

interface Recorded {
  model: string;
  transcript: { title: string; text: string; product: Product; published: string };
  prediction: Prediction;
  recorded_stages_ms: { classifying: number };
}

export const RECORDED = recordedJson as unknown as Recorded;

export const RECORDED_NOTICE =
  "Recorded result from the local model on a laptop. This page doesn't run the model.";

export const sampleNote = () => ({ title: RECORDED.transcript.title, text: RECORDED.transcript.text, product: RECORDED.transcript.product });

export const isRecordedNote = (text: string) => text.trim() === RECORDED.transcript.text.trim();

/** Turn the recorded prediction into an EvidenceItem. Aspects whose span isn't found are returned as rejected. */
export function recordedEvidence(text: string): { evidence: EvidenceItem; rejected: { aspect: AspectEvidence["aspect"]; span: string; reason: string }[] } {
  const p = RECORDED.prediction;
  const aspects: AspectEvidence[] = [];
  const rejected: { aspect: AspectEvidence["aspect"]; span: string; reason: string }[] = [];
  for (const key of ASPECTS) {
    const v = p[key];
    if (!v) continue;
    const start = text.indexOf(v.span);
    if (start < 0) { rejected.push({ aspect: key, span: v.span, reason: "not an exact substring of the transcript" }); continue; }
    aspects.push({ aspect: key, polarity: v.polarity, speaker: v.speaker, span: v.span, span_start: start, span_end: start + v.span.length });
  }
  const t = RECORDED.transcript;
  return {
    rejected,
    evidence: {
      item_id: p.item_id,
      source: "transcript",
      url: `urn:vitra:transcript:${p.item_id}`,
      published: t.published,
      iso_week: isoWeekOf(t.published),
      product: t.product,
      title: `${t.title} (recorded result)`,
      text,
      signal_type: p.signal_type,
      actionable: p.actionable,
      origin: "synthetic_demo",
      aspects,
      confidence: {
        level: "low",
        method: "model",
        span_verified: aspects.length > 0,
        source_authority: "private",
        corroborating_items: 0,
        notes: [`Recorded output of ${RECORDED.model} on a synthetic note. ${RECORDED_NOTICE}`],
      },
    },
  };
}
