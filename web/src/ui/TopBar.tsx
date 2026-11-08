import { useEffect, useState } from "react";
import { onInstallReady, promptInstall } from "../pwa.ts";
import { useVitra } from "../store/useVitra.ts";
import { IconButton, Segmented, Select } from "./controls.tsx";
import { PRODUCT_OPTIONS, aspectOptions, signalOptions, sourceOptions, speakerOptions } from "./options.ts";
import { useArrival } from "../scene/arrival.ts";

export function TopBar() {
  const f = useVitra((s) => s.filters);
  const setFilter = useVitra((s) => s.setFilter);
  const resetFilters = useVitra((s) => s.resetFilters);
  const weeks = useVitra((s) => s.weeks);
  const railOpen = useVitra((s) => s.railOpen);
  const setRail = useVitra((s) => s.setRail);
  const view = useVitra((s) => s.view);
  const setView = useVitra((s) => s.setView);
  const setIntakeOpen = useVitra((s) => s.setIntakeOpen);
  const sourceKind = useVitra((s) => s.sourceKind);
  const sourceLabel = useVitra((s) => s.sourceLabel);
  const [canInstall, setCanInstall] = useState(false);
  const engaged = useArrival((s) => s.engaged);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => onInstallReady(setCanInstall), []);

  const filtered = f.product !== "all" || f.speaker !== "all" || f.aspect !== "all" || f.source !== "all" || f.signalType !== "all"
    || f.weekFrom !== weeks[0] || f.weekTo !== weeks[weeks.length - 1];

  return (
    <header className="pointer-events-auto relative z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-bg/80 px-4 py-2 backdrop-blur-md md:flex-nowrap">
      <div className="mr-1 flex items-baseline gap-2.5">
        <h1 className="font-serif text-[26px] leading-none tracking-tight text-text">Vitra</h1>
        <span className="hidden whitespace-nowrap text-[12px] text-text-muted 2xl:inline">Launch evidence for EGFR lung cancer</span>
      </div>

      <Segmented label="Product" value={f.product} options={PRODUCT_OPTIONS} onChange={(v) => setFilter("product", v)} />

      {!(engaged || filtersOpen || filtered) ? (
        <button
          type="button"
          onClick={() => { setFiltersOpen(true); useArrival.getState().engage(); }}
          aria-expanded={false}
          className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-[13px] text-text-2 transition-colors hover:border-border-strong hover:text-text"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M2 3.5h10M4 7h6M6 10.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          Filters
        </button>
      ) : (
      <nav aria-label="Filters" className="filters-in scroll-thin order-last -mx-1 flex w-full items-center gap-1.5 overflow-x-auto px-1 md:order-none md:w-auto md:overflow-visible">
        <Select label="Speaker" value={f.speaker} options={speakerOptions()} onChange={(v) => setFilter("speaker", v)} />
        <Select label="Aspect" value={f.aspect} options={aspectOptions()} onChange={(v) => setFilter("aspect", v)} />
        <Select label="Source" value={f.source} options={sourceOptions()} onChange={(v) => setFilter("source", v)} />
        <Select label="Signal" value={f.signalType} options={signalOptions()} onChange={(v) => setFilter("signalType", v)} />
        {filtered && (
          <button type="button" onClick={resetFilters} className="whitespace-nowrap px-1.5 text-[13px] text-accent hover:text-accent-hover">
            Clear filters
          </button>
        )}
      </nav>
      )}

      <div className="ml-auto flex items-center gap-2">
        <span
          className={`hidden whitespace-nowrap rounded-md border px-2 py-1 text-[12px] lg:inline ${sourceKind === "fixtures" ? "border-dashed border-border-strong text-text-2" : "border-border text-text-2"}`}
          title={sourceKind === "fixtures" ? "All evidence on screen is invented demo text" : "Reading the local API on 127.0.0.1"}
        >
          {sourceLabel}
        </span>
        {canInstall && (
          <button
            type="button"
            onClick={() => {
              void promptInstall();
            }}
            className="whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-[13px] text-text-2 transition-colors hover:border-border-strong hover:text-text"
          >
            Install app
          </button>
        )}
        <button
          type="button"
          onClick={() => setIntakeOpen(true)}
          className="whitespace-nowrap rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-bg transition-colors hover:bg-accent-hover"
        >
          Add a transcript
        </button>
        <Segmented
          label="View"
          size="sm"
          value={view}
          onChange={setView}
          options={[{ value: "3d", label: "3D", hint: "Interactive 3D scene" }, { value: "2d", label: "2D", hint: "Flat view with the same data and controls" }]}
        />
        <IconButton label={railOpen ? "Hide the report panel" : "Show the report panel"} onClick={() => setRail(!railOpen)} pressed={railOpen}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M10 2.5v11" stroke="currentColor" strokeWidth="1.2" /></svg>
        </IconButton>
      </div>
    </header>
  );
}
