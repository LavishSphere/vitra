/**
 * A short tour of moves the scene already knows. Shown once after arrival if nothing
 * else has been touched, and always again from the Experience Vitra chip.
 */
import { useEffect, useRef, useState } from "react";
import { useArrival } from "../scene/arrival.ts";
import {
  GUIDED_ENTRY,
  GUIDED_FOOTER,
  GUIDED_STEPS,
  GUIDED_TIME,
  GUIDED_TITLE,
  type GuidedStepId,
  exploreLung,
  runSampleIntake,
  selectSafetyEvidence,
} from "./guided.ts";

export function GuidedExperience() {
  const arriving = useArrival((s) => s.arriving);
  const engaged = useArrival((s) => s.engaged);
  const [open, setOpen] = useState(false);
  const offered = useRef(false);

  useEffect(() => {
    if (arriving || offered.current) return;
    offered.current = true;
    if (!engaged) setOpen(true);
  }, [arriving, engaged]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (arriving) return null;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hint-in pointer-events-auto absolute inset-x-0 top-16 z-20 mx-auto w-fit rounded-full bg-accent px-4 py-2 text-[13.5px] font-medium text-bg shadow-[var(--shadow-panel)] transition-colors hover:bg-accent-hover"
      >
        {GUIDED_ENTRY}
      </button>
    );
  }

  const run = (id: GuidedStepId, origin: Element) => {
    if (id === "lung") exploreLung(origin);
    else if (id === "evidence") selectSafetyEvidence();
    else runSampleIntake();
    setOpen(false);
  };

  return (
    <section
      aria-labelledby="guided-title"
      className="panel hint-in pointer-events-auto absolute inset-x-0 top-16 z-20 mx-auto w-[min(420px,calc(100%-2rem))] rounded-xl p-3.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="guided-title" className="text-[15px] font-medium text-text">{GUIDED_TITLE}</h2>
          <span className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[11px] text-accent-hover">{GUIDED_TIME}</span>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="shrink-0 text-[12.5px] text-accent hover:text-accent-hover">
          Close
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {GUIDED_STEPS.map((step) => (
          <button
            key={step.id}
            type="button"
            onClick={(e) => run(step.id, e.currentTarget)}
            className="w-full rounded-lg border border-border bg-bg/60 px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-bg-hover"
          >
            <span className="block text-[13px] text-text">{step.title}</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-text-2">{step.body}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-text-muted">{GUIDED_FOOTER}</p>
    </section>
  );
}
