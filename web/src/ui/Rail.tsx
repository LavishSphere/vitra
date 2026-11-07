import { useEffect, useMemo, useState } from "react";
import { ASPECTS, SPEAKERS, type AspectKey, type InsightCard, type Product, type Speaker } from "@contract/types.ts";
import { useVitra, type RailTab } from "../store/useVitra.ts";
import { TrendChart } from "./TrendChart.tsx";
import { ASPECT_LABEL, PRODUCT_LABEL, SPEAKER_LABEL, SOURCE_LABEL } from "./options.ts";
import { speakerVar } from "../theme.ts";
import { humanize } from "../lib/format.ts";
import { PolarityChip } from "./controls.tsx";
import { STATIONS } from "../data/stations.ts";
import { rubricPoints, RUBRIC_TEXT } from "../data/confidence.ts";
import { EXPECTED_VOICES } from "../data/gaps.ts";
import { GAP_TITLE, gapCountLabel, gapEmptyLine, gapIntro, gapIsFocused, gapRowName } from "../lib/gapFocus.ts";

function useMaxWidth(px: number) {
  const query = `(max-width: ${px}px)`;
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const fn = () => setOn(m.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, [query]);
  return on;
}

const GAP_COLS = "grid grid-cols-[minmax(0,1.15fr)_minmax(0,1.7fr)_4.5rem_4.75rem] items-baseline";

const TABS: { id: RailTab; label: string }[] = [
  { id: "trends", label: "Trends" },
  { id: "cards", label: "Insights" },
  { id: "gaps", label: "Gaps" },
  { id: "evidence", label: "Evidence" },
];

export const RAIL_WIDTH = 420;

export function Rail() {
  const open = useVitra((s) => s.railOpen);
  const tab = useVitra((s) => s.railTab);
  const setRail = useVitra((s) => s.setRail);
  const cards = useVitra((s) => s.cards);
  const gaps = useVitra((s) => s.gaps);
  const product = useVitra((s) => s.filters.product);
  const nCards = cards.filter((c) => product === "all" || c.product === product).length;
  const nGaps = gaps.filter((g) => product === "all" || g.product === product).length;

  return (
    <aside
      aria-label="Report"
      aria-hidden={!open}
      inert={!open}
      className={`pointer-events-auto absolute bottom-0 right-0 top-0 z-20 flex flex-col border-l border-border bg-bg-elevated/90 backdrop-blur-xl transition-transform duration-500 ease-[var(--ease-out-soft)] max-md:inset-x-0 max-md:top-auto max-md:h-[58%] max-md:border-l-0 max-md:border-t ${
        open ? "translate-x-0 max-md:translate-y-0" : "translate-x-full max-md:translate-x-0 max-md:translate-y-full"
      }`}
      style={{ width: `min(100%, ${RAIL_WIDTH}px)` }}
    >
      <div role="tablist" aria-label="Report sections" className="flex shrink-0 gap-1 border-b border-border px-3 pt-2">
        {TABS.map((t) => {
          const on = tab === t.id;
          const count = t.id === "cards" ? nCards : t.id === "gaps" ? nGaps : null;
          return (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={on}
              aria-controls={`panel-${t.id}`}
              onClick={() => setRail(true, t.id)}
              className={`-mb-px flex items-baseline gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-[13px] transition-colors ${
                on ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text"
              }`}
            >
              {t.label}
              {count !== null && <span className="num text-[11px] text-text-muted">{count}</span>}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        {tab === "trends" && <TrendsSection />}
        {tab === "cards" && <CardsSection />}
        {tab === "gaps" && <GapsSection />}
        {tab === "evidence" && <EvidenceSection />}
      </div>
    </aside>
  );
}

function SectionHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-[15px] font-medium text-text">{title}</h2>
      {children && <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">{children}</p>}
    </div>
  );
}

function TrendsSection() {
  const trends = useVitra((s) => s.trends);
  const weeks = useVitra((s) => s.weeks);
  const f = useVitra((s) => s.filters);
  const select = useVitra((s) => s.select);
  const excluded = useVitra((s) => s.excluded);
  const recomputing = useVitra((s) => s.recomputing);

  const range = useMemo(() => weeks.filter((w) => w >= f.weekFrom && w <= f.weekTo), [weeks, f.weekFrom, f.weekTo]);
  const aspects: AspectKey[] = f.aspect === "all" ? ASPECTS : [f.aspect];
  const products: Product[] = useMemo(() => (f.product === "all" ? ["A", "B"] : [f.product]), [f.product]);
  const inRange = useMemo(() => {
    const set = new Set(range);
    return trends.filter((c) => set.has(c.week) && c.speaker !== "all" && c.aspect !== "all");
  }, [trends, range]);
  const stacked = useMaxWidth(639);
  const speakersPresent = useMemo(() => {
    const s = new Set<Speaker>();
    for (const c of inRange) if (c.n_items > 0 && products.includes(c.product)) s.add(c.speaker as Speaker);
    return SPEAKERS.filter((x) => s.has(x) && (f.speaker === "all" || f.speaker === x));
  }, [inRange, products, f.speaker]);

  return (
    <div>
      <SectionHead title="Weekly polarity by speaker">
        Mean polarity per ISO week of publication, from {"−"}2 to +2. A week with no evidence is left empty. Dot size grows with N.
      </SectionHead>
      {f.product === "all" && (
        <p className="mb-3 border-l-2 border-border-strong pl-3 text-[12.5px] leading-relaxed text-text-2">
          Tagrisso and Rybrevant + Lazcluze differ in regimen and studied population, so reading these side by side as a head-to-head comparison isn't valid.
        </p>
      )}
      {(f.source !== "all" || f.signalType !== "all") && (
        <p className="mb-3 text-[12px] text-text-muted">Source and signal filters change the scene and the evidence list. Trends are grouped by product, speaker and aspect only.</p>
      )}
      <ul className="mb-4 flex flex-wrap gap-x-3 gap-y-1" aria-label="Speaker colors">
        {speakersPresent.map((s) => (
          <li key={s} className="flex items-center gap-1.5 text-[12px] text-text-2">
            <span className="h-[3px] w-3.5 rounded-full" style={{ background: speakerVar(s) }} />
            {SPEAKER_LABEL[s]}
          </li>
        ))}
      </ul>
      <ResetLine excluded={excluded.length} recomputing={recomputing} />
      {f.product === "all" && (
        <div className="mb-1 hidden grid-cols-2 gap-4 text-[12px] text-text-muted sm:grid">
          <span>{PRODUCT_LABEL.A}</span><span>{PRODUCT_LABEL.B}</span>
        </div>
      )}
      <div className="divide-y divide-border">
        {aspects.map((a) => (
          <div key={a} className={`grid gap-4 py-3 ${products.length > 1 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
            {products.map((p) => (
              <TrendChart
                key={p}
                compact={products.length > 1 && !stacked}
                title={ASPECT_LABEL[a]}
                subtitle={products.length > 1 ? PRODUCT_LABEL[p] : undefined}
                cells={inRange.filter((c) => c.product === p && c.aspect === a)}
                weeks={range}
                speakers={speakersPresent}
                onOpen={(id) => select({ itemId: id, aspect: a })}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResetLine({ excluded, recomputing }: { excluded: number; recomputing: boolean }) {
  const transcripts = useVitra((s) => s.evidence.filter((e) => e.source === "transcript").length);
  const reset = useVitra((s) => s.resetExcluded);
  if (!excluded && !transcripts) return null;
  const parts = [
    excluded ? `${excluded} excluded item${excluded > 1 ? "s" : ""}` : null,
    transcripts ? `${transcripts} pasted transcript${transcripts > 1 ? "s" : ""}` : null,
  ].filter(Boolean).join(" and ");
  return (
    <p className="mb-3 flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-text-2" aria-live="polite">
      <span>{recomputing ? "Recomputing" : `Recomputed with ${parts}.`}</span>
      <button type="button" onClick={() => void reset()} className="text-accent hover:text-accent-hover">Reset to source data</button>
    </p>
  );
}

function CardsSection() {
  const cards = useVitra((s) => s.cards);
  const product = useVitra((s) => s.filters.product);
  const shown = cards.filter((c) => product === "all" || c.product === product);
  return (
    <div>
      <SectionHead title="Insight cards">
        Each card is built from cited items. Click a citation to read the quote in its source.
      </SectionHead>
      {shown.length === 0 && <p className="text-[13px] text-text-muted">No cards for this product.</p>}
      <ol className="divide-y divide-border">
        {shown.map((c) => <CardRow key={c.id} card={c} />)}
      </ol>
    </div>
  );
}

function CardRow({ card }: { card: InsightCard }) {
  const select = useVitra((s) => s.select);
  const excluded = useVitra((s) => s.excluded);
  const nEx = card.citations.filter((c) => excluded.includes(c.item_id)).length;
  const conf = card.confidence;
  return (
    <li className="py-4 first:pt-1">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 text-[12px] text-text-muted">
        <span>{PRODUCT_LABEL[card.product]}</span>
        <span aria-hidden>·</span>
        <span className="num">{card.week}</span>
        <span aria-hidden>·</span>
        <span>{humanize(card.signal_type)}</span>
        {card.actionable && <><span aria-hidden>·</span><span className="text-text-2">Actionable</span></>}
      </div>
      <h3 className="text-[14.5px] font-medium leading-snug text-text">{card.headline}</h3>
      <dl className="mt-2 grid grid-cols-[92px_1fr] gap-x-3 gap-y-1.5 text-[12.5px] leading-relaxed">
        <dt className="text-text-muted">Fact</dt><dd className="text-text-2">{card.fact}</dd>
        <dt className="text-text-muted">Observed</dt><dd className="text-text-2">{card.observed_sentiment}</dd>
        <dt className="text-text-muted">Reading</dt><dd className="italic text-text-2">{card.interpretation}</dd>
        <dt className="text-text-muted">Why it matters</dt><dd className="text-text-2">{card.why_it_matters}</dd>
        <dt className="text-text-muted">Cited</dt>
        <dd className="flex flex-wrap gap-1.5">
          {card.citations.map((c) => {
            const ex = excluded.includes(c.item_id);
            return (
              <button
                key={`${c.item_id}-${c.aspect}`}
                type="button"
                onClick={() => select({ itemId: c.item_id, aspect: c.aspect })}
                className={`num rounded-md border border-border px-1.5 py-0.5 text-[11.5px] transition-colors hover:border-accent hover:text-accent-hover ${ex ? "text-text-muted line-through" : "text-accent"}`}
                title={`"${c.span}"`}
              >
                {c.item_id} {humanize(c.aspect)}
              </button>
            );
          })}
        </dd>
        <dt className="text-text-muted">Confidence</dt>
        <dd className="text-text-2" title={RUBRIC_TEXT}>
          <span className="capitalize text-text">{conf.level}</span>
          <span className="text-text-muted"> · {rubricPoints(conf)} points · {humanize(conf.source_authority)} source · {conf.method} · {conf.corroborating_items} corroborating · span {conf.span_verified ? "verified" : "unverified"}</span>
        </dd>
      </dl>
      {nEx > 0 && (
        <p className="mt-2 text-[12px] text-text-2">{nEx} of {card.citations.length} cited items excluded. This card would need review.</p>
      )}
    </li>
  );
}

function GapsSection() {
  const gaps = useVitra((s) => s.gaps);
  const filters = useVitra((s) => s.filters);
  const focusGap = useVitra((s) => s.focusGap);
  const product = filters.product;
  const [all, setAll] = useState(false);
  const sourceKind = useVitra((s) => s.sourceKind);
  const windowWeeks = gaps[0]?.window_weeks ?? 8;
  const matching = gaps
    .filter((g) => product === "all" || g.product === product)
    .sort((a, b) => (a.last_seen_week ?? "").localeCompare(b.last_seen_week ?? "") || a.speaker.localeCompare(b.speaker));
  const shown = all ? matching : matching.slice(0, 12);
  const focused = matching.find((g) => gapIsFocused(filters, g));
  return (
    <div>
      <SectionHead title={GAP_TITLE}>
        {gapIntro(windowWeeks)}
      </SectionHead>
      {shown.length === 0 ? (
        <p className="text-[13px] text-text-muted">{gapEmptyLine(product)}</p>
      ) : (
        <div className="text-[12.5px]">
          <div className={`${GAP_COLS} border-b border-border text-text-muted`}>
            <span className="py-1.5 pr-2">Product</span>
            <span className="py-1.5 pr-2">Missing voice</span>
            <span className="py-1.5 pr-2 text-right">Count</span>
            <span className="py-1.5 text-right">Last seen</span>
          </div>
          <div className="divide-y divide-border">
            {shown.map((g) => {
              const on = gapIsFocused(filters, g);
              const voice = `${SPEAKER_LABEL[g.speaker]} on ${ASPECT_LABEL[g.aspect].toLowerCase()}`;
              return (
                <button
                  key={`${g.product}-${g.speaker}-${g.aspect}`}
                  type="button"
                  aria-pressed={on}
                  aria-label={gapRowName(PRODUCT_LABEL[g.product], SPEAKER_LABEL[g.speaker], ASPECT_LABEL[g.aspect].toLowerCase(), g.n_items_in_window, g.window_weeks)}
                  onClick={() => focusGap(g)}
                  className={`${GAP_COLS} w-full py-2 text-left hover:bg-accent-soft ${on ? "bg-accent-soft" : ""}`}
                >
                  <span className="pr-2 text-text-2">{PRODUCT_LABEL[g.product]}</span>
                  <span className="pr-2 text-text">{voice}</span>
                  <span className="num pr-2 text-right text-text-2">{gapCountLabel(g.n_items_in_window)}</span>
                  <span className="num text-right text-text-2">{g.last_seen_week ?? "never"}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {focused && (
        <p role="status" className="mt-3 text-[12.5px] text-text-2">
          Scene and timeline are on {PRODUCT_LABEL[focused.product]}, {SPEAKER_LABEL[focused.speaker].toLowerCase()} on {ASPECT_LABEL[focused.aspect].toLowerCase()}, {filters.weekFrom} to {filters.weekTo}.
        </p>
      )}
      {matching.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="mt-2 text-[12.5px] text-accent hover:text-accent-hover">
          Show all {matching.length}
        </button>
      )}
      {sourceKind === "fixtures" && (
        <>
          <h3 className="mt-6 text-[13px] text-text">Voices checked</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">
            {EXPECTED_VOICES.map((v) => `${SPEAKER_LABEL[v.speaker].toLowerCase()} on ${ASPECT_LABEL[v.aspect].toLowerCase()}`).join(", ")}. Items tagged with both products count for each.
          </p>
        </>
      )}
    </div>
  );
}

function EvidenceSection() {
  const marks = useVitra((s) => s.marks);
  const focus = useVitra((s) => s.focusStation);
  const setFocus = useVitra((s) => s.setFocusStation);
  const select = useVitra((s) => s.select);
  const station = STATIONS.find((s) => s.id === focus);
  const rows = useMemo(
    () => marks.filter((m) => m.visible && (!focus || m.station === focus))
      .sort((a, b) => b.item.iso_week.localeCompare(a.item.iso_week) || a.item.item_id.localeCompare(b.item.item_id)),
    [marks, focus],
  );
  return (
    <div>
      <SectionHead title={station ? station.label : "All evidence in view"}>
        {station ? `${station.rule}.` : "Every quote that matches the current filters, newest first."}{" "}
        {rows.length} quote{rows.length === 1 ? "" : "s"}.
        {station && <> <button type="button" className="text-accent hover:text-accent-hover" onClick={() => setFocus(null)}>Show all stations</button></>}
      </SectionHead>
      <ul className="divide-y divide-border">
        {rows.map((m) => (
          <li key={m.key}>
            <button
              type="button"
              onClick={() => select({ itemId: m.item.item_id, aspect: m.aspect.aspect })}
              className={`group w-full py-2.5 text-left ${m.excluded ? "opacity-50" : ""}`}
            >
              <div className="flex items-center justify-between gap-2 text-[11.5px] text-text-muted">
                <span className="num">{m.item.iso_week} · {m.item.item_id} · {SOURCE_LABEL[m.item.source]}</span>
                <PolarityChip value={m.aspect.polarity} />
              </div>
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-text-2 group-hover:text-text">&ldquo;{m.aspect.span}&rdquo;</p>
              <p className="mt-0.5 text-[11.5px] text-text-muted">
                {ASPECT_LABEL[m.aspect.aspect]} · {SPEAKER_LABEL[m.aspect.speaker]}{m.excluded ? " · excluded" : ""}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
