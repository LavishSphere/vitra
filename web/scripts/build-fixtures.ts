/**
 * Builds the SYNTHETIC fixtures in src/fixtures from scripts/fixture-seed.ts.
 * Span offsets come from text.indexOf(span); a missing or ambiguous span fails the build.
 * Trends and gaps come from the same pure functions the UI uses.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import type { AspectEvidence, Confidence, EvidenceItem, InsightCard, IntakeResult } from "../../contracts/types.ts";
import { SEED, SEED_CARDS, SAMPLE_TRANSCRIPT, type SeedAspect } from "./fixture-seed.ts";
import { isoWeekOf } from "../src/lib/isoWeek.ts";
import { computeTrends } from "../src/data/trends.ts";
import { computeGaps } from "../src/data/gaps.ts";
import { AUTHORITY_BY_SOURCE, CORROBORATION_WINDOW_WEEKS, levelFor, rubricPoints, AUTHORITY_ORDER } from "../src/data/confidence.ts";

const OUT = new URL("../src/fixtures/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const synId = (n: number) => `SYN-${String(n).padStart(4, "0")}`;

function locate(id: string, text: string, [aspect, polarity, speaker, span]: SeedAspect): AspectEvidence {
  const start = text.indexOf(span);
  if (start < 0) throw new Error(`${id} ${aspect}: span not found: ${span}`);
  if (text.indexOf(span, start + 1) >= 0) throw new Error(`${id} ${aspect}: span is ambiguous`);
  return { aspect, polarity, speaker, span, span_start: start, span_end: start + span.length };
}

const METHOD = (src: string): Confidence["method"] =>
  src === "ctgov" || src.startsWith("fda_") ? "rule" : "model";

const base: EvidenceItem[] = SEED.map((s): EvidenceItem => {
  const id = synId(s.n);
  return {
    item_id: id, source: s.source, url: `urn:vitra:synthetic:${id}`, published: s.date,
    iso_week: isoWeekOf(s.date), product: s.product, title: s.title, text: s.text,
    signal_type: s.signal, actionable: s.actionable, origin: "synthetic_demo",
    aspects: s.aspects.map((a) => locate(id, s.text, a)),
    confidence: { level: "low", method: METHOD(s.source), span_verified: true,
      source_authority: AUTHORITY_BY_SOURCE[s.source], corroborating_items: 0, notes: [] },
  };
}).sort((a, b) => a.published.localeCompare(b.published) || a.item_id.localeCompare(b.item_id));

// Corroboration (same rule as app/evidence.py): other items with the same aspect and polarity
// sign within +/-2 ISO weeks whose product overlaps.
const weekNum = (w: string) => Number(w.slice(0, 4)) * 53 + Number(w.slice(6));
const overlap = (a: string, b: string) => a === b || a === "both" || b === "both";
for (const it of base) {
  const others = new Set<string>();
  for (const o of base) {
    if (o.item_id === it.item_id || !overlap(o.product, it.product)) continue;
    if (Math.abs(weekNum(o.iso_week) - weekNum(it.iso_week)) > CORROBORATION_WINDOW_WEEKS) continue;
    if (it.aspects.some((a) => o.aspects.some((b) => b.aspect === a.aspect && Math.sign(b.polarity) === Math.sign(a.polarity)))) others.add(o.item_id);
  }
  const c = it.confidence;
  c.corroborating_items = others.size;
  const pts = rubricPoints(c);
  c.level = levelFor(pts, c.span_verified);
  c.notes = [
    `Rubric points ${pts}: method ${c.method}, authority ${c.source_authority}, ${others.size} corroborating item(s).`,
    ...(others.size ? [`Corroborated by ${[...others].sort().join(", ")}.`] : []),
    "SYNTHETIC demo item. Text is invented.",
  ];
}

const byN = new Map(SEED.map((s) => [s.n, base.find((b) => b.item_id === synId(s.n))!]));
const cards: InsightCard[] = SEED_CARDS.map((sc) => {
  const cited = sc.cite.map(([n, aspect]) => {
    const item = byN.get(n)!;
    const a = item.aspects.find((x) => x.aspect === aspect);
    if (!a) throw new Error(`${sc.id}: ${item.item_id} has no ${aspect}`);
    return { item, a };
  });
  const methods = new Set(cited.map((c) => c.item.confidence.method));
  const authority = cited.map((c) => c.item.confidence.source_authority)
    .sort((x, y) => AUTHORITY_ORDER.indexOf(x) - AUTHORITY_ORDER.indexOf(y))[0];
  const conf: Confidence = {
    level: "low", method: methods.size > 1 ? "mixed" : [...methods][0], span_verified: true,
    source_authority: authority, corroborating_items: cited.length - 1, notes: [],
  };
  const pts = rubricPoints(conf);
  conf.level = levelFor(pts);
  conf.notes = [`Rubric points ${pts} from the strongest cited source and ${cited.length} cited item(s).`];
  return {
    id: sc.id, headline: sc.headline, signal_type: sc.signal_type, product: sc.product, week: sc.week,
    actionable: cited.some((c) => c.item.actionable === "yes"), why_it_matters: sc.why,
    citations: cited.map(({ item, a }) => ({ item_id: item.item_id, aspect: a.aspect, span: a.span, span_start: a.span_start, span_end: a.span_end, url: item.url })),
    confidence: conf, fact: sc.fact, observed_sentiment: sc.observed, interpretation: sc.interpretation,
  };
});

const trends = computeTrends(base);
const gaps = computeGaps(base, new Set(), 8);

const tId = "SYN-T001";
const tAspects = SAMPLE_TRANSCRIPT.aspects.map((a) => locate(tId, SAMPLE_TRANSCRIPT.text, a));
const intakeEvidence: EvidenceItem = {
  item_id: tId, source: "transcript", url: "urn:vitra:transcript:SYN-T001", published: SAMPLE_TRANSCRIPT.date,
  iso_week: isoWeekOf(SAMPLE_TRANSCRIPT.date), product: SAMPLE_TRANSCRIPT.product, title: SAMPLE_TRANSCRIPT.title,
  text: SAMPLE_TRANSCRIPT.text, signal_type: "expert_opinion", actionable: "no", origin: "synthetic_demo",
  aspects: tAspects,
  confidence: { level: "low", method: "model", span_verified: true, source_authority: "private", corroborating_items: 0,
    notes: ["Stored SYNTHETIC result for fixture mode. Not a live model run."] },
};
const intake: IntakeResult & { transcript: { title: string; text: string; product: string } } = {
  status: "complete",
  stages: [],
  evidence: intakeEvidence,
  rejected_spans: [{ aspect: "safety", span: "nurses want a two-page skin care handout", reason: "not an exact substring of the transcript" }],
  reason: null,
  error: null,
  transcript: { title: SAMPLE_TRANSCRIPT.title, text: SAMPLE_TRANSCRIPT.text, product: SAMPLE_TRANSCRIPT.product },
};

const write = (name: string, data: unknown) => writeFileSync(new URL(name, OUT), JSON.stringify(data, null, 1) + "\n");
write("evidence.json", base);
write("trends.json", trends);
write("cards.json", cards);
write("gaps.json", gaps);
write("intake.json", intake);
console.log(`evidence ${base.length}, aspects ${base.reduce((n, b) => n + b.aspects.length, 0)}, trend cells ${trends.length}, cards ${cards.length}, gaps ${gaps.length}`);
console.log("gaps:", gaps.map((g) => `${g.product} ${g.speaker} ${g.aspect} last=${g.last_seen_week}`).join(" | "));
console.log("weeks:", base[0].iso_week, "to", base[base.length - 1].iso_week, "levels:", base.map((b) => b.confidence.level[0]).join(""));
