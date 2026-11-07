import { useEffect, useRef, useState } from "react";
import type { IntakeResult, IntakeStageName, Product } from "@contract/types.ts";
import { useVitra } from "../store/useVitra.ts";
import { dataSource } from "../data/index.ts";
import { Segmented } from "./controls.tsx";
import { ASPECT_LABEL, SPEAKER_LABEL } from "./options.ts";
import { PolarityChip } from "./controls.tsx";
import { spanIsVerified } from "../data/spans.ts";

type StageName = IntakeStageName | "complete";
const STAGES: { name: StageName; label: string }[] = [
  { name: "received_locally", label: "Received locally" },
  { name: "classifying", label: "Classifying" },
  { name: "validating_quotes", label: "Validating quotes" },
  { name: "incorporating", label: "Incorporating" },
  { name: "complete", label: "Complete" },
];

interface Run {
  phase: "idle" | "running" | "done";
  startedAt: number;
  result: IntakeResult | null;
  incorporateMs: number | null;
}

export function IntakePanel() {
  const open = useVitra((s) => s.intakeOpen);
  const setOpen = useVitra((s) => s.setIntakeOpen);
  const incorporate = useVitra((s) => s.incorporate);
  const select = useVitra((s) => s.select);
  const sourceKind = useVitra((s) => s.sourceKind);
  const [text, setText] = useState("");
  const [product, setProduct] = useState<Product>("B");
  const [run, setRun] = useState<Run>({ phase: "idle", startedAt: 0, result: null, incorporateMs: null });
  const [elapsed, setElapsed] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    area.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
      if (e.key !== "Tab" || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>("button, textarea, [href]")].filter((el) => !el.hasAttribute("disabled"));
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, setOpen]);

  // Real elapsed time while waiting on the classifier. Nothing is simulated.
  useEffect(() => {
    if (run.phase !== "running") return;
    const id = window.setInterval(() => setElapsed(performance.now() - run.startedAt), 100);
    return () => window.clearInterval(id);
  }, [run.phase, run.startedAt]);

  if (!open) return null;

  const loadSample = async () => {
    const s = await dataSource.sampleTranscript();
    if (s) { setText(s.text); setProduct(s.product); }
  };

  const analyze = async () => {
    const t0 = performance.now();
    setRun({ phase: "running", startedAt: t0, result: null, incorporateMs: null });
    setElapsed(0);
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
    let incorporateMs: number | null = null;
    if (result.status === "complete" && result.evidence?.aspects.length) {
      const t1 = performance.now();
      await incorporate(result);
      incorporateMs = Math.round((performance.now() - t1) * 10) / 10;
    }
    setRun({ phase: "done", startedAt: t0, result, incorporateMs });
  };

  const r = run.result;
  const stageMs = (name: StageName): number | null => {
    if (name === "incorporating") return run.incorporateMs;
    return r?.stages.find((s) => s.name === name)?.ms ?? null;
  };
  const stageState = (name: StageName): "pending" | "running" | "done" | "skipped" => {
    if (run.phase === "idle") return "pending";
    if (run.phase === "running") return name === "received_locally" ? "done" : name === "classifying" ? "running" : "pending";
    if (!r) return "pending";
    if (name === "complete") return r.status === "complete" ? "done" : "skipped";
    if (name === "incorporating") return run.incorporateMs !== null ? "done" : "skipped";
    return r.stages.some((s) => s.name === name) ? "done" : "skipped";
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[#05080e]/55" onClick={() => setOpen(false)} aria-hidden />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="intake-title"
        className="relative flex h-full w-full max-w-[520px] flex-col border-l border-border bg-bg-elevated shadow-[var(--shadow-panel)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h2 id="intake-title" className="text-[17px] font-medium text-text">Add a transcript</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
              Paste an advisory board note or a field report. It's analyzed on this machine, held in memory and never saved.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-[12.5px] text-text-2 hover:text-text">Close</button>
        </header>

        <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">
          {sourceKind === "fixtures" && (
            <p className="mb-4 border-l-2 border-border-strong pl-3 text-[12.5px] leading-relaxed text-text-2">
              Fixture mode. The local classifier isn't connected, so only the stored synthetic sample can run. Quote checks and the recompute still run for real.
            </p>
          )}
          <label htmlFor="intake-text" className="mb-1.5 block text-[13px] text-text-2">Transcript text</label>
          <textarea
            id="intake-text"
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Paste text here"
            className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2.5 text-[13.5px] leading-relaxed text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Segmented
              label="Product"
              size="sm"
              value={product}
              onChange={setProduct}
              options={[{ value: "A", label: "Tagrisso" }, { value: "B", label: "Rybrevant + Lazcluze" }]}
            />
            <button type="button" onClick={() => void loadSample()} className="px-1.5 text-[13px] text-accent hover:text-accent-hover">
              Use the synthetic sample
            </button>
            <button
              type="button"
              onClick={() => void analyze()}
              disabled={!text.trim() || run.phase === "running"}
              className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-bg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Analyze locally
            </button>
          </div>

          <h3 className="mb-2 mt-6 text-[13px] text-text-muted">Stages</h3>
          <ol className="divide-y divide-border text-[13px]" aria-live="polite">
            {STAGES.map((s) => {
              const st = stageState(s.name);
              const ms = s.name === "classifying" && run.phase === "running" ? elapsed : stageMs(s.name);
              return (
                <li key={s.name} className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-2.5">
                    <StageDot state={st} />
                    <span className={st === "pending" || st === "skipped" ? "text-text-muted" : "text-text"}>{s.label}</span>
                    {st === "skipped" && <span className="text-[12px] text-text-muted">skipped</span>}
                  </span>
                  <span className="num text-[12px] text-text-muted">
                    {s.name === "classifying" && sourceKind === "fixtures" && st === "done" ? "stored result" : ms !== null && st !== "pending" ? `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms` : ""}
                  </span>
                </li>
              );
            })}
          </ol>

          {r && <ResultBlock result={r} onOpen={(id, aspect) => { setOpen(false); select({ itemId: id, aspect }); }} />}
        </div>
      </div>
    </div>
  );
}

function StageDot({ state }: { state: "pending" | "running" | "done" | "skipped" }) {
  if (state === "running") return <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-label="running" />;
  if (state === "done") return <span className="h-2 w-2 rounded-full bg-text-2" aria-label="done" />;
  return <span className="h-2 w-2 rounded-full border border-border-strong" aria-label={state} />;
}

function ResultBlock({ result, onOpen }: { result: IntakeResult; onOpen: (id: string, aspect?: never) => void }) {
  const ev = result.evidence;
  return (
    <div className="mt-6">
      <h3 className="mb-2 text-[13px] text-text-muted">Result</h3>
      {result.status === "error" && <p className="text-[13px] leading-relaxed text-text-2">{result.error}</p>}
      {result.status === "abstained" && (
        <p className="text-[13px] leading-relaxed text-text-2">
          The model abstained{result.reason ? `: ${result.reason}` : ". Nothing in the text could be scored with a verified quote."}
        </p>
      )}
      {ev && ev.aspects.length > 0 && (
        <>
          <ul className="divide-y divide-border">
            {ev.aspects.map((a) => (
              <li key={a.aspect} className="py-2.5">
                <div className="flex items-center justify-between text-[12px] text-text-muted">
                  <span>{ASPECT_LABEL[a.aspect]} · {SPEAKER_LABEL[a.speaker]}</span>
                  <PolarityChip value={a.polarity} />
                </div>
                <p className="mt-0.5 text-[13px] text-text">&ldquo;{a.span}&rdquo;</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12.5px] text-text-2">
            Joined the evidence as <span className="num">{ev.item_id}</span> in <span className="num">{ev.iso_week}</span>. Trends were recomputed.{" "}
            <button type="button" className="text-accent hover:text-accent-hover" onClick={() => onOpen(ev.item_id)}>Open it in the X-Ray</button>
          </p>
        </>
      )}
      {result.rejected_spans.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1 text-[12.5px] text-text-muted">Rejected quotes</h4>
          <ul className="space-y-1.5 text-[12.5px]">
            {result.rejected_spans.map((s) => (
              <li key={s.span} className="text-text-2">
                <span className="line-through decoration-magenta/70">&ldquo;{s.span}&rdquo;</span>
                <span className="text-text-muted"> {ASPECT_LABEL[s.aspect]}, {s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
