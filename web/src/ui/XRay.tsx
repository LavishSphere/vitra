import { useEffect, useMemo, useRef, useState } from "react";
import type { AspectEvidence, EvidenceItem } from "@contract/types.ts";
import { useVitra } from "../store/useVitra.ts";
import { dataSource } from "../data/index.ts";
import { displayableAspects, segmentText } from "../data/spans.ts";
import { whatIf, type Aggregate } from "../data/trends.ts";
import { AUTHORITY_POINTS, METHOD_POINTS, corroborationPoints, rubricPoints, RUBRIC_TEXT } from "../data/confidence.ts";
import { ASPECT_LABEL, PRODUCT_LABEL, SOURCE_LABEL, SPEAKER_LABEL } from "./options.ts";
import { OriginBadge, PolarityChip } from "./controls.tsx";
import { POLARITY_WORD, humanize, signedPolarity } from "../lib/format.ts";
import { polarityCss } from "../theme.ts";
import { STATIONS, stationFor } from "../data/stations.ts";

function useFocusTrap(active: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current;
    root?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab" || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [active, onClose]);
  return ref;
}

export function XRay() {
  const selection = useVitra((s) => s.selection);
  const select = useVitra((s) => s.select);
  const evidence = useVitra((s) => s.evidence);
  const stored = selection ? evidence.find((e) => e.item_id === selection.itemId) : undefined;
  const [full, setFull] = useState<EvidenceItem | null>(null);

  useEffect(() => {
    setFull(null);
    if (!selection) return;
    let live = true;
    void dataSource.item(selection.itemId).then((it) => { if (live) setFull(it); });
    return () => { live = false; };
  }, [selection]);

  const close = useMemo(() => () => select(null), [select]);
  const trap = useFocusTrap(!!stored, close);
  if (!selection || !stored) return null;
  const item = full && full.text.length >= stored.text.length ? full : stored;

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center p-3 md:p-8">
      <div className="absolute inset-0 bg-[#05080e]/70 backdrop-blur-[3px]" onClick={close} aria-hidden />
      <div
        ref={trap}
        role="dialog"
        aria-modal="true"
        aria-labelledby="xray-title"
        className="relative flex max-h-full w-full max-w-[1080px] flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-[var(--shadow-panel)]"
      >
        <XRayBody item={item} aspectKey={selection.aspect} onClose={close} />
      </div>
    </div>
  );
}

function XRayBody({ item, aspectKey, onClose }: { item: EvidenceItem; aspectKey?: string; onClose: () => void }) {
  const select = useVitra((s) => s.select);
  const aspects = displayableAspects(item);
  const hidden = item.aspects.length - aspects.length;
  const current: AspectEvidence | undefined = aspects.find((a) => a.aspect === aspectKey) ?? aspects[0];
  const segments = useMemo(() => segmentText(item.text, aspects), [item.text, aspects]);

  return (
    <>
      <header className="flex items-start gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-text-muted">
            <span className="text-text-2">{SOURCE_LABEL[item.source]}</span>
            <span aria-hidden>·</span>
            <span className="num">{item.published}</span>
            <span aria-hidden>·</span>
            <span className="num">{item.iso_week}</span>
            <span aria-hidden>·</span>
            <span>{PRODUCT_LABEL[item.product]}</span>
            <span aria-hidden>·</span>
            <span className="num">{item.item_id}</span>
            <OriginBadge origin={item.origin} />
          </div>
          <h2 id="xray-title" className="text-[19px] font-medium leading-snug text-text">{item.title}</h2>
        </div>
        <button
          type="button"
          data-autofocus
          onClick={onClose}
          className="flex shrink-0 items-center gap-2 rounded-lg border border-border px-2.5 py-1 text-[12.5px] text-text-2 hover:border-border-strong hover:text-text"
        >
          Close <kbd className="num rounded border border-border px-1 text-[10.5px] text-text-muted">Esc</kbd>
        </button>
      </header>

      <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:overflow-hidden">
        <section aria-label="Source text" className="scroll-thin border-border px-6 py-5 md:overflow-y-auto md:border-r">
          <h3 className="mb-3 text-[13px] text-text-muted">Full source text</h3>
          <p className="text-[16.5px] leading-[1.75] text-text-2">
            {segments.map((seg) => {
              if (!seg.aspects.length) return <span key={seg.start}>{seg.text}</span>;
              const isCurrent = current && seg.aspects.some((a) => a.aspect === current.aspect);
              const a = isCurrent ? current! : seg.aspects[0];
              return (
                <mark
                  key={seg.start}
                  className={isCurrent ? "span-hit" : "span-other cursor-pointer"}
                  style={isCurrent ? ({ "--mark-color": polarityCss(a.polarity) } as React.CSSProperties) : undefined}
                  onClick={isCurrent ? undefined : () => select({ itemId: item.item_id, aspect: a.aspect })}
                  title={`${ASPECT_LABEL[a.aspect]} ${signedPolarity(a.polarity)} · ${SPEAKER_LABEL[a.speaker]}`}
                >
                  {seg.text}
                </mark>
              );
            })}
          </p>
          {current && (
            <p className="mt-4 text-[12.5px] text-text-muted">
              Highlighted quote: characters <span className="num text-text-2">{current.span_start}</span> to{" "}
              <span className="num text-text-2">{current.span_end}</span>, checked against the source text above.
            </p>
          )}
          {hidden > 0 && (
            <p className="mt-2 text-[12.5px] text-text-2">{hidden} quote{hidden > 1 ? "s" : ""} not shown because the offsets didn't match the text.</p>
          )}
          <dl className="mt-5 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 border-t border-border pt-4 text-[12.5px]">
            <dt className="text-text-muted">Link</dt>
            <dd className="num break-all text-text-2">
              {item.url.startsWith("urn:vitra:synthetic") ? "None. This is a synthetic demo item." : item.url.startsWith("urn:vitra:transcript") ? "None. Pasted transcript, held in memory only." : item.url}
            </dd>
            <dt className="text-text-muted">Published</dt>
            <dd className="num text-text-2">{item.published} (bucketed into {item.iso_week})</dd>
            <dt className="text-text-muted">Signal</dt>
            <dd className="text-text-2">{item.signal_type === "none" ? "No signal" : humanize(item.signal_type)} · {item.actionable === "yes" ? "actionable" : "not actionable"}</dd>
          </dl>
        </section>

        <section aria-label="Scores and impact" className="scroll-thin px-6 py-5 md:overflow-y-auto">
          <h3 className="mb-2 text-[13px] text-text-muted">Aspects in this item</h3>
          <table className="w-full text-left text-[13px]">
            <thead className="text-[12px] text-text-muted">
              <tr className="border-b border-border">
                <th className="py-1.5 pr-2 font-normal">Aspect</th>
                <th className="py-1.5 pr-2 font-normal">Polarity</th>
                <th className="py-1.5 font-normal">Speaker</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {aspects.map((a) => {
                const on = current?.aspect === a.aspect;
                return (
                  <tr key={a.aspect} className={on ? "bg-accent-soft" : ""}>
                    <td className="py-2 pr-2">
                      <button
                        type="button"
                        onClick={() => select({ itemId: item.item_id, aspect: a.aspect })}
                        aria-pressed={on}
                        className={`text-left ${on ? "text-text" : "text-accent hover:text-accent-hover"}`}
                      >
                        {ASPECT_LABEL[a.aspect]}
                      </button>
                      <div className="text-[11.5px] text-text-muted">{STATIONS.find((s) => s.id === stationFor(a.aspect, a.speaker))?.label} station</div>
                    </td>
                    <td className="py-2 pr-2">
                      <PolarityChip value={a.polarity} />
                      <div className="text-[11.5px] text-text-muted">{POLARITY_WORD[a.polarity]}</div>
                    </td>
                    <td className="py-2 text-text-2">{SPEAKER_LABEL[a.speaker]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <ConfidenceBlock item={item} />
          <WhatIfBlock item={item} />
        </section>
      </div>
    </>
  );
}

function ConfidenceBlock({ item }: { item: EvidenceItem }) {
  const c = item.confidence;
  const select = useVitra((s) => s.select);
  const corroborators = (c.notes.find((n) => n.startsWith("Corroborated by")) ?? "")
    .replace("Corroborated by ", "").replace(/\.$/, "").split(", ").filter(Boolean);
  return (
    <div className="mt-6">
      <h3 className="mb-2 flex items-baseline justify-between text-[13px] text-text-muted">
        <span>Confidence</span>
        <span className="text-text"><span className="capitalize">{c.level}</span> <span className="num text-text-muted">{rubricPoints(c)} pts</span></span>
      </h3>
      <table className="w-full text-[12.5px]">
        <tbody className="divide-y divide-border">
          <tr><td className="py-1.5 text-text-muted">Source authority</td><td className="py-1.5 text-text-2">{humanize(c.source_authority)}</td><td className="num py-1.5 text-right text-text-2">+{AUTHORITY_POINTS[c.source_authority] ?? 0}</td></tr>
          <tr><td className="py-1.5 text-text-muted">Method</td><td className="py-1.5 text-text-2">{c.method === "rule" ? "rule-derived" : c.method === "model" ? "model-derived" : c.method}</td><td className="num py-1.5 text-right text-text-2">+{METHOD_POINTS[c.method]}</td></tr>
          <tr>
            <td className="py-1.5 align-top text-text-muted">Corroborating</td>
            <td className="py-1.5 text-text-2">
              {c.corroborating_items} item{c.corroborating_items === 1 ? "" : "s"}
              {corroborators.length > 0 && (
                <span className="ml-1">
                  {corroborators.map((id) => (
                    <button key={id} type="button" onClick={() => select({ itemId: id })} className="num mr-1.5 text-[11.5px] text-accent hover:text-accent-hover">{id}</button>
                  ))}
                </span>
              )}
            </td>
            <td className="num py-1.5 text-right align-top text-text-2">+{corroborationPoints(c.corroborating_items)}</td>
          </tr>
          <tr><td className="py-1.5 text-text-muted">Span verified</td><td className="py-1.5 text-text-2">{c.span_verified ? "yes, exact substring" : "no"}</td><td /></tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11.5px] leading-relaxed text-text-muted">{RUBRIC_TEXT}</p>
    </div>
  );
}

function Delta({ before, after }: { before: Aggregate; after: Aggregate }) {
  return (
    <span className="num inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span style={{ color: polarityCss(before.mean_polarity) }}>{signedPolarity(before.mean_polarity, 2)}</span>
      <span className="text-text-muted">N={before.n_items}</span>
      <span className="text-text-muted" aria-label="becomes">&rarr;</span>
      <span style={{ color: polarityCss(after.mean_polarity) }}>{signedPolarity(after.mean_polarity, 2)}</span>
      <span className="text-text-muted">N={after.n_items}</span>
    </span>
  );
}

function WhatIfBlock({ item }: { item: EvidenceItem }) {
  const evidence = useVitra((s) => s.evidence);
  const excludedList = useVitra((s) => s.excluded);
  const f = useVitra((s) => s.filters);
  const toggle = useVitra((s) => s.toggleExclude);
  const reset = useVitra((s) => s.resetExcluded);
  const recomputing = useVitra((s) => s.recomputing);
  const isExcluded = excludedList.includes(item.item_id);
  const rows = useMemo(
    () => whatIf(evidence, new Set(excludedList), item.item_id, { weekFrom: f.weekFrom, weekTo: f.weekTo }),
    [evidence, excludedList, item.item_id, f.weekFrom, f.weekTo],
  );

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-[13px] text-text-muted">{isExcluded ? "If you restore this item" : "If you exclude this item"}</h3>
      <table className="w-full text-[12.5px]">
        <tbody className="divide-y divide-border">
          {rows.flatMap((r) => [
            <tr key={`${r.aspect}-cell`}>
              <td className="py-1.5 pr-2 text-text-muted">{r.week}, {SPEAKER_LABEL[r.speaker].toLowerCase()} on {ASPECT_LABEL[r.aspect].toLowerCase()}</td>
              <td className="py-1.5 text-right"><Delta before={r.cellBefore} after={r.cellAfter} /></td>
            </tr>,
            <tr key={`${r.aspect}-win`}>
              <td className="py-1.5 pr-2 text-text-muted">{PRODUCT_LABEL[r.product]} {ASPECT_LABEL[r.aspect].toLowerCase()}, {f.weekFrom.slice(5)} to {f.weekTo.slice(5)}</td>
              <td className="py-1.5 text-right"><Delta before={r.windowBefore} after={r.windowAfter} /></td>
            </tr>,
          ])}
        </tbody>
      </table>
      <p className="mt-2 text-[11.5px] text-text-muted">Both sides come from the same recompute over the evidence list. Nothing is patched.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void toggle(item.item_id)}
          disabled={recomputing}
          aria-pressed={isExcluded}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-60 ${
            isExcluded ? "border border-accent/60 bg-accent-soft text-text hover:bg-accent/20" : "bg-accent text-bg hover:bg-accent-hover"
          }`}
        >
          {isExcluded ? "Restore this item" : "Exclude from the analysis"}
        </button>
        {excludedList.length > 0 && (
          <button type="button" onClick={() => void reset()} className="rounded-lg px-2 py-1.5 text-[13px] text-accent hover:text-accent-hover">
            Reset to source data ({excludedList.length} excluded)
          </button>
        )}
        <span className="text-[12px] text-text-muted" aria-live="polite">{recomputing ? "Recomputing" : ""}</span>
      </div>
    </div>
  );
}
