import { useMemo } from "react";
import { STATIONS, type StationId } from "../data/stations.ts";
import { useVitra, type Mark } from "../store/useVitra.ts";
import { polarityCss } from "../theme.ts";
import { signedPolarity } from "../lib/format.ts";
import { ASPECT_LABEL, SPEAKER_LABEL } from "./options.ts";

/**
 * The 2.5D view: used when WebGL isn't available, when reduced motion is on, or by choice.
 * Same store, same marks, same quote panel. No animation loop.
 */
export function Flat2D({ railPx }: { railPx: number }) {
  const marks = useVitra((s) => s.marks);
  const weeks = useVitra((s) => s.weeks);
  const product = useVitra((s) => s.filters.product);
  const focusTumor = useVitra((s) => s.focusTumor);
  const setFocusTumor = useVitra((s) => s.setFocusTumor);
  const accent = product === "B" ? "var(--color-blue)" : "var(--color-cyan)";

  const byStation = useMemo(() => {
    const m = new Map<StationId, Mark[]>();
    for (const s of STATIONS) m.set(s.id, []);
    for (const mk of marks) if (mk.visible) m.get(mk.station)!.push(mk);
    return m;
  }, [marks]);

  return (
    <div className="scroll-thin absolute inset-0 overflow-y-auto bg-[radial-gradient(ellipse_at_50%_30%,#101a2b_0%,#0a0e17_60%)] pb-40 pt-6 transition-[padding] duration-500" style={{ paddingRight: railPx }}>
      <div className="mx-auto flex max-w-[1100px] flex-col items-center px-4">
        <LungsSvg accent={accent} active={focusTumor} onTumor={() => setFocusTumor(!focusTumor)} />
        <p className="mt-1 text-[12px] text-text-muted">Illustrative anatomy</p>
        <div className="mt-6 grid w-full gap-x-5 gap-y-8" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(176px, 1fr))" }}>
          {STATIONS.map((s, i) => <StationPlot key={s.id} index={i} id={s.id} marks={byStation.get(s.id)!} weeks={weeks} />)}
        </div>
      </div>
    </div>
  );
}

function StationPlot({ id, index, marks, weeks }: { id: StationId; index: number; marks: Mark[]; weeks: string[] }) {
  const def = STATIONS[index];
  const select = useVitra((s) => s.select);
  const focus = useVitra((s) => s.focusStation);
  const setFocus = useVitra((s) => s.setFocusStation);
  const from = useVitra((s) => s.filters.weekFrom);
  const to = useVitra((s) => s.filters.weekTo);
  const pulses = useVitra((s) => s.pulses);
  const n = weeks.length;
  const idx = useMemo(() => new Map(weeks.map((w, i) => [w, i])), [weeks]);
  const pos = (m: Mark, k: number) => ({
    left: `${4 + ((idx.get(m.item.iso_week) ?? 0) / Math.max(1, n - 1)) * 92}%`,
    top: `${50 - m.aspect.polarity * 21 + (k % 2 ? 4 : 0)}%`,
  });
  const stacks = new Map<string, number>();
  const live = count(marks);
  const isFocus = focus === id;

  return (
    <section aria-label={def.label}>
      <button
        type="button"
        onClick={() => setFocus(isFocus ? null : id)}
        aria-pressed={isFocus}
        className={`mb-2 flex w-full items-baseline gap-2 text-left text-[13px] ${isFocus ? "text-accent" : "text-text hover:text-accent-hover"}`}
      >
        <span className="num text-text-muted">{index + 1}</span>
        {def.label}
        <span className="num ml-auto text-text-muted">{live}</span>
      </button>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${def.label} chart. Click empty space to focus this station.`}
        aria-pressed={isFocus}
        onClick={() => setFocus(isFocus ? null : id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setFocus(isFocus ? null : id);
          }
        }}
        className={`relative h-40 cursor-pointer rounded-lg border bg-bg-elevated/60 ${isFocus ? "border-accent/60" : "border-border"}`}
      >
        {[2, 1, 0, -1, -2].map((p) => (
          <div key={p} className="absolute inset-x-2 border-t" style={{ top: `${50 - p * 21}%`, borderColor: p === 0 ? "var(--color-border-strong)" : "var(--color-border)", borderStyle: p === 0 ? "solid" : "dashed" }}>
            {(p === 2 || p === 0 || p === -2) && <span className="num absolute -top-2 left-0 bg-bg-elevated/80 pr-1 text-[9.5px] text-text-muted">{signedPolarity(p)}</span>}
          </div>
        ))}
        {marks.map((m) => {
          const key = `${m.item.iso_week}|${m.aspect.polarity}`;
          const k = stacks.get(key) ?? 0;
          stacks.set(key, k + 1);
          const inRange = m.item.iso_week >= from && m.item.iso_week <= to;
          const pulsing = pulses.some((p) => p.itemId === m.item.item_id);
          return (
            <button
              key={m.key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                select({ itemId: m.item.item_id, aspect: m.aspect.aspect });
              }}
              aria-label={`${m.item.item_id}, ${ASPECT_LABEL[m.aspect.aspect]}, polarity ${signedPolarity(m.aspect.polarity)}, ${SPEAKER_LABEL[m.aspect.speaker]}, ${m.item.iso_week}`}
              title={`"${m.aspect.span}"`}
              className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-150 focus-visible:scale-150 ${pulsing ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : ""}`}
              style={{
                ...pos(m, k),
                marginLeft: k ? `${(k % 2 ? 1 : -1) * Math.ceil(k / 2) * 7}px` : undefined,
                background: m.excluded ? "var(--color-border-strong)" : polarityCss(m.aspect.polarity),
                opacity: inRange ? 1 : 0.25,
              }}
            />
          );
        })}
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-text-muted">{def.rule}</p>
    </section>
  );
}

const count = (marks: Mark[]) => marks.filter((m) => !m.excluded).length;

function LungsSvg({ accent, active, onTumor }: { accent: string; active: boolean; onTumor: () => void }) {
  return (
    <svg viewBox="0 0 400 300" className="h-[220px] w-auto" role="img" aria-label="Stylized lungs with a tumor hotspot in the right upper lobe">
      <defs>
        <radialGradient id="lg-fill" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.02" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.16" />
        </radialGradient>
        <radialGradient id="tumor-glow">
          <stop offset="0%" stopColor="var(--color-magenta)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--color-magenta)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g fill="url(#lg-fill)" stroke={accent} strokeWidth="1.4" strokeOpacity="0.85">
        <path d="M178 82 C150 60 120 70 104 110 C88 150 78 205 84 248 C88 268 112 272 140 262 C162 254 176 246 180 230 C184 190 184 120 178 82 Z" />
        <path d="M222 82 C250 60 282 70 298 112 C314 154 322 206 316 248 C312 268 290 272 262 262 C246 256 232 250 226 238 C232 222 236 210 222 196 C216 160 216 120 222 82 Z" />
      </g>
      <g fill="none" stroke={accent} strokeOpacity="0.55" strokeLinecap="round">
        <path d="M200 20 V96" strokeWidth="6" strokeOpacity="0.35" />
        <path d="M200 96 L170 118 M200 96 L232 120" strokeWidth="4" />
        <path d="M170 118 L150 150 L132 190 M150 150 L162 196 M170 118 L140 112 L122 132 M132 190 L118 222 M132 190 L142 230" strokeWidth="1.6" />
        <path d="M232 120 L252 154 L270 196 M252 154 L240 200 M232 120 L262 116 L280 138 M270 196 L284 228 M270 196 L262 236" strokeWidth="1.6" />
      </g>
      <g role="button" tabIndex={0} aria-label="Tumor hotspot, illustrative" aria-pressed={active} className="cursor-pointer outline-none" onClick={onTumor} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTumor(); } }}>
        <circle cx="136" cy="128" r="26" fill="url(#tumor-glow)" />
        <circle cx="136" cy="128" r="7" fill="var(--color-magenta)" />
        {active && <circle cx="136" cy="128" r="14" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />}
      </g>
    </svg>
  );
}
