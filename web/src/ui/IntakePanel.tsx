/**
 * The judge moment, in one card next to the scene: paste a note, watch the real stages, see the
 * classification, follow each quote to its station, then read what changed and undo it.
 */
import { useEffect, useRef, useState } from "react";
import type { IntakeResult, IntakeStageName, Product } from "@contract/types.ts";
import { useVitra } from "../store/useVitra.ts";
import { dataSource } from "../data/index.ts";
import { Segmented, PolarityChip } from "./controls.tsx";
import { ASPECT_LABEL, PRODUCT_LABEL, SPEAKER_LABEL } from "./options.ts";
import { spanIsVerified } from "../data/spans.ts";
import { RECORDED_NOTICE, isRecordedNote } from "../data/recorded.ts";
import { STATIONS, stationFor } from "../data/stations.ts";
import { POLARITY_WORD } from "../lib/format.ts";
import { ImpactCard } from "./ImpactCard.tsx";

type StageName = IntakeStageName | "complete";
const STAGES: { name: StageName; label: string }[] = [
  { name: "received_locally", label: "Received" },
  { name: "classifying", label: "Classifying" },
  { name: "validating_quotes", label: "Verified" },
  { name: "incorporating", label: "Added" },
  { name: "complete", label: "Complete" },
];

type Phase = "compose" | "running" | "placing" | "impact";

interface Run {
  startedAt: number;
  result: IntakeResult | null;
  incorporateMs: number | null;
}

/** How long the camera stays on the last station before the summary opens. */
const LAST_STOP_MS = 2600;

export const stationLabel = (id: string) => STATIONS.find((s) => s.id === id)?.label ?? id;

/**
 * The card sits just under the report tabs. The demo banner only shows in fixture mode, so the
 * offset is measured from the page instead of hard-coded.
 */
function useTopOffset(active: boolean): number {
  const [top, setTop] = useState(160);
  useEffect(() => {
    if (!active) return;
    const measure = () => {
      const tabs = document.querySelector('#report [role="tablist"]');
      const main = document.querySelector("main");
      const edge = tabs?.getBoundingClientRect().bottom ?? (main ? main.getBoundingClientRect().top + 42 : 148);
      setTop(Math.round(edge + 12));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [active]);
  return top;
}

function useReducedMotion(): boolean {
  const [on, setOn] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fn = () => setOn(m.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, []);
  return on;
}

export function IntakePanel() {
  const open = useVitra((s) => s.intakeOpen);
  const setOpen = useVitra((s) => s.setIntakeOpen);
  const incorporate = useVitra((s) => s.incorporate);
  const session = useVitra((s) => s.session);
  const view = useVitra((s) => s.view);
  const sourceKind = useVitra((s) => s.sourceKind);
  const reduced = useReducedMotion();
  const top = useTopOffset(open);
  const [text, setText] = useState("");
  const [product, setProduct] = useState<Product>("B");
  const [phase, setPhase] = useState<Phase>("compose");
  const [run, setRun] = useState<Run>({ startedAt: 0, result: null, incorporateMs: null });
  const [elapsed, setElapsed] = useState(0);
  const [stop, setStop] = useState(0);
  const [announce, setAnnounce] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);

  useEffect(() => { if (open && phase === "compose") area.current?.focus(); }, [open, phase]);

  // Real elapsed time while waiting on the classifier. Nothing is simulated.
  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setInterval(() => setElapsed(performance.now() - run.startedAt), 100);
    return () => window.clearInterval(id);
  }, [phase, run.startedAt]);

  // The session can end elsewhere (Reset to source data). Go back to the form.
  useEffect(() => {
    if (session || (phase !== "placing" && phase !== "impact")) return;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPhase("compose");
  }, [session, phase]);

  // Skip the tour with Escape or a click on the scene.
  useEffect(() => {
    if (phase !== "placing") return;
    const finish = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      useVitra.getState().skipTour();
      setPhase("impact");
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); finish(); } };
    const onDown = (e: PointerEvent) => { if ((e.target as HTMLElement).tagName === "CANVAS") finish(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); };
  }, [phase]);

  if (!open) return null;

  const fixtures = sourceKind === "fixtures";
  const isSample = isRecordedNote(text);

  const finishTour = () => {
    clearTimers();
    useVitra.getState().skipTour();
    setPhase("impact");
  };

  const loadSample = async () => {
    const s = await dataSource.sampleTranscript();
    if (s) { setText(s.text); setProduct(s.product === "A" ? "A" : "B"); }
  };

  const analyze = async () => {
    clearTimers();
    setNotice(null);
    const t0 = performance.now();
    setRun({ startedAt: t0, result: null, incorporateMs: null });
    setElapsed(0);
    setStop(0);
    setPhase("running");
    setAnnounce("Received locally. Classifying.");
    let result: IntakeResult;
    try {
      result = await dataSource.intake({ text, product });
    } catch (e) {
      result = { status: "error", stages: [], evidence: null, rejected_spans: [], reason: null, error: e instanceof Error ? e.message : String(e) };
    }
    // Belt and braces: never incorporate a quote that isn't in the pasted text.
    if (result.evidence) {
      const ev = result.evidence;
      ev.aspects = ev.aspects.filter((a) => spanIsVerified(ev.text, a));
    }
    if (result.status !== "complete" || !result.evidence?.aspects.length) {
      setRun({ startedAt: t0, result, incorporateMs: null });
      setPhase("compose");
      setAnnounce(result.status === "error" ? `Stopped. ${result.error ?? ""}` : `The model abstained. ${result.reason ?? ""}`);
      return;
    }
    const tour = !reduced && view === "3d";
    const t1 = performance.now();
    await incorporate(result, { tour });
    const incorporateMs = Math.round((performance.now() - t1) * 10) / 10;
    setRun({ startedAt: t0, result, incorporateMs });
    const n = result.evidence.aspects.length;
    setAnnounce(`Classified. ${n} quote${n === 1 ? "" : "s"} verified and added.`);

    const sess = useVitra.getState().session;
    if (!sess || !tour) { setPhase("impact"); return; }
    setPhase("placing");
    const now = performance.now();
    sess.tour.forEach((t, i) => {
      timers.current.push(window.setTimeout(() => {
        setStop(i);
        useVitra.getState().focusCameraOn(t.station, "intake");
      }, Math.max(0, t.startAt - now)));
    });
    const last = sess.tour[sess.tour.length - 1];
    timers.current.push(window.setTimeout(() => {
      useVitra.getState().clearFocus();
      setPhase("impact");
    }, last.startAt - now + LAST_STOP_MS));
  };

  const startOver = () => { clearTimers(); setPhase("compose"); setRun({ startedAt: 0, result: null, incorporateMs: null }); };

  const r = run.result;
  const stageMs = (name: StageName): number | null => {
    if (name === "incorporating") return run.incorporateMs;
    return r?.stages.find((s) => s.name === name)?.ms ?? null;
  };
  const stageState = (name: StageName): "pending" | "running" | "done" | "skipped" => {
    if (phase === "running") return name === "received_locally" ? "done" : name === "classifying" ? "running" : "pending";
    if (!r) return "pending";
    if (name === "complete") return r.status === "complete" && run.incorporateMs !== null ? "done" : "skipped";
    if (name === "incorporating") return run.incorporateMs !== null ? "done" : "skipped";
    return r.stages.some((s) => s.name === name) ? "done" : "skipped";
  };
  const recordedClassify = fixtures && !!r && r.status !== "error";

  return (
    <section
      aria-labelledby="intake-title"
      // Near-opaque: the report rail sits right behind this card and must not show through.
      style={{ top, maxHeight: `calc(100vh - ${top + 16}px)`, background: "rgb(17 22 31 / 0.97)" }}
      className="panel scroll-thin pointer-events-auto fixed right-3 z-40 flex h-fit w-[396px] max-w-[calc(100vw-24px)] flex-col overflow-y-auto rounded-xl"
    >
      <p className="sr-only" aria-live="polite" role="status">{announce}</p>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 pb-3 pt-3.5">
        <div>
          <h2 id="intake-title" className="text-[15px] font-medium text-text">
            {phase === "impact" ? "What changed" : "Add evidence"}
          </h2>
          {phase === "compose" && !fixtures && (
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-muted">
              Paste an advisory board note or a field report. Sent only to the local API on 127.0.0.1, held in its memory, cleared on reset or exit. Vitra doesn't write it to disk.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => { if (phase === "placing") finishTour(); setOpen(false); }}
          className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[12px] text-text-2 hover:border-border-strong hover:text-text"
        >
          Close
        </button>
      </header>

      <div className="px-4 pb-4 pt-3">
        {phase === "compose" && (
          <>
            {notice && <p className="rise-in mb-3 rounded-lg bg-accent-soft px-3 py-2 text-[12.5px] leading-relaxed text-text">{notice}</p>}
            {fixtures && (
              <p className="mb-3 border-l-2 border-border-strong pl-2.5 text-[12px] leading-relaxed text-text-2">
                This page can only replay the sample note. Its result was recorded from the local model on a laptop. Quote checks and the recompute still run here for real.
              </p>
            )}
            <label htmlFor="intake-text" className="sr-only">Transcript text</label>
            <textarea
              id="intake-text"
              ref={area}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder={fixtures ? "Click Use a sample note" : "Paste text here"}
              className="w-full resize-y rounded-lg border border-border bg-bg/70 px-3 py-2 text-[13px] leading-relaxed text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
            {fixtures && text.trim() && !isSample && (
              <p className="mt-1.5 text-[12px] text-text-2">This text isn't the sample note, so this page can't classify it. The laptop build runs the model on any text.</p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void loadSample()} className="rounded-md px-1 text-[13px] text-accent hover:text-accent-hover">
                Use a sample note
              </button>
              <Segmented
                label="Product"
                size="sm"
                value={product}
                onChange={setProduct}
                options={[{ value: "A", label: "Tagrisso" }, { value: "B", label: "Rybrevant" }]}
              />
              <button
                type="button"
                onClick={() => void analyze()}
                disabled={!text.trim() || (fixtures && !isSample)}
                className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-bg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Analyze locally
              </button>
            </div>
            {r && r.status !== "complete" && (
              <p className="mt-3 text-[12.5px] leading-relaxed text-text-2">
                {r.status === "error" ? r.error : `The model abstained${r.reason ? `: ${r.reason}` : ". Nothing could be scored with a verified quote."}`}
              </p>
            )}
          </>
        )}

        {phase !== "compose" && (
          <ol className="mb-3 grid grid-cols-5 gap-1.5" aria-label="Stages">
            {STAGES.map((s) => {
              const st = stageState(s.name);
              const ms = s.name === "classifying" && phase === "running" ? elapsed : stageMs(s.name);
              return (
                <li key={s.name} className="min-w-0">
                  <div className={`h-[3px] rounded-full ${st === "done" ? "bg-accent" : st === "running" ? "animate-pulse bg-accent/60" : "bg-border"}`} />
                  <div className={`mt-1.5 truncate text-[11px] ${st === "pending" || st === "skipped" ? "text-text-muted" : "text-text-2"}`}>{s.label}</div>
                  <div className="num text-[11px] text-text-muted">
                    {st === "pending" || st === "skipped" || ms === null || s.name === "complete" ? " " : `${ms < 10 ? ms.toFixed(1) : Math.round(ms).toLocaleString("en-US")} ms`}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {phase !== "compose" && recordedClassify && (
          <p className="mb-3 text-[11.5px] leading-relaxed text-text-muted">{RECORDED_NOTICE}</p>
        )}

        {phase === "running" && (
          <p className="text-[12.5px] text-text-2">The local model is reading the note. This usually takes a few seconds on a laptop.</p>
        )}

        {(phase === "placing" || phase === "impact") && r?.evidence && (
          <Classification result={r} stop={phase === "placing" ? stop : -1} compact={phase === "impact"} />
        )}

        {phase === "placing" && session && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-[12.5px] text-text-2">
            <span className="min-w-0 truncate">
              Now at {stationLabel(session.tour[stop]?.station ?? "")}
              <span className="num text-text-muted"> {stop + 1}/{session.tour.length}</span>
            </span>
            <button type="button" onClick={finishTour} className="text-accent hover:text-accent-hover">
              Skip <kbd className="num ml-0.5 rounded border border-border px-1 text-[10.5px] text-text-muted">Esc</kbd>
            </button>
          </div>
        )}

        {phase === "impact" && session && (
          <ImpactCard
            session={session}
            onUndone={(msg) => { setAnnounce(msg); setNotice(msg); startOver(); }}
            onKeep={() => { useVitra.getState().dismissSession(); setNotice(null); startOver(); }}
          />
        )}
      </div>
    </section>
  );
}

/** What the model said, one row per verified quote. The row for the station on screen is lit. */
function Classification({ result, stop, compact }: { result: IntakeResult; stop: number; compact: boolean }) {
  const ev = result.evidence!;
  const select = useVitra((s) => s.select);
  const session = useVitra((s) => s.session);
  const order = session?.tour.map((t) => t.station) ?? [];
  if (compact) {
    return (
      <ul className="space-y-1" aria-label="New quotes">
        {ev.aspects.map((a) => (
          <li key={a.aspect}>
            <button
              type="button"
              onClick={() => select({ itemId: ev.item_id, aspect: a.aspect })}
              className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-bg-hover"
            >
              <span className="min-w-0 text-text">&ldquo;{a.span}&rdquo;
                <span className="block text-[11.5px] text-text-muted">{PRODUCT_LABEL[ev.product]}, {SPEAKER_LABEL[a.speaker]}, {ASPECT_LABEL[a.aspect].toLowerCase()}</span>
              </span>
              <PolarityChip value={a.polarity} />
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div>
      <dl className="rise-in grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
        <dt className="text-text-muted">Drug</dt>
        <dd className="text-text">{PRODUCT_LABEL[ev.product]}</dd>
        <dt className="text-text-muted">Signal</dt>
        <dd className="text-text-2">{ev.signal_type === "none" ? "No signal type" : ev.signal_type.replace(/_/g, " ")}, {ev.actionable === "yes" ? "actionable" : "not actionable"}</dd>
      </dl>
      <ul className="mt-2.5 space-y-2">
        {ev.aspects.map((a, i) => {
          const station = stationFor(a.aspect, a.speaker);
          const active = stop >= 0 && order[stop] === station;
          return (
            <li key={a.aspect} className="rise-in" style={{ animationDelay: `${120 + i * 140}ms` }}>
              <button
                type="button"
                onClick={() => select({ itemId: ev.item_id, aspect: a.aspect })}
                aria-label={`${ASPECT_LABEL[a.aspect]}, ${SPEAKER_LABEL[a.speaker]}, ${POLARITY_WORD[a.polarity]}. Open the source and see the quote.`}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${active ? "border-accent/70 bg-accent-soft" : "border-border hover:border-border-strong hover:bg-bg-hover"}`}
              >
                <span className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-text-2">{ASPECT_LABEL[a.aspect]} <span className="text-text-muted">· {SPEAKER_LABEL[a.speaker]}</span></span>
                  <span className="flex items-center gap-2">
                    <span className="text-text-muted">{POLARITY_WORD[a.polarity]}</span>
                    <PolarityChip value={a.polarity} />
                  </span>
                </span>
                <span className="mt-1 block text-[13px] leading-snug text-text">&ldquo;{a.span}&rdquo;</span>
                <span className="mt-1 flex items-center justify-between gap-2 text-[11.5px] text-text-muted">
                  <span>Verified at characters <span className="num">{a.span_start} to {a.span_end}</span></span>
                  <span>{stationLabel(station)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {result.rejected_spans.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12px]">
          {result.rejected_spans.map((s) => (
            <li key={s.span} className="text-text-2">
              <span className="line-through decoration-magenta/70">&ldquo;{s.span}&rdquo;</span>
              <span className="text-text-muted"> rejected, {s.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
