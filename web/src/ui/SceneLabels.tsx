import { useMemo } from "react";
import { Vector3 } from "three";
import { STATIONS } from "../data/stations.ts";
import { useVitra, type Mark } from "../store/useVitra.ts";
import { anchorRef, markPositions } from "../scene/labels.ts";
import { stationAxisAnchor, stationLabelAnchor } from "../scene/layout.ts";
import { TUMOR_POSITION } from "../scene/anatomy.ts";
import { signedPolarity, humanize } from "../lib/format.ts";
import { polarityCss } from "../theme.ts";

const TUMOR_ANCHOR = TUMOR_POSITION.clone().add(new Vector3(-0.2, 0.32, 0));

/** DOM labels pinned to scene positions. Focusable, so the stations work from the keyboard. */
export function SceneLabels() {
  const focus = useVitra((s) => s.focusStation);
  const setFocus = useVitra((s) => s.setFocusStation);
  const focusTumor = useVitra((s) => s.focusTumor);
  const setFocusTumor = useVitra((s) => s.setFocusTumor);
  const marks = useVitra((s) => s.marks);
  const hovered = useVitra((s) => s.hovered);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of marks) if (m.visible && !m.excluded) c[m.station] = (c[m.station] ?? 0) + 1;
    return c;
  }, [marks]);
  const stationAnchors = useMemo(() => STATIONS.map((s) => stationLabelAnchor(s.id)), []);
  const axisAnchors = useMemo(
    () => (focus ? [2, 1, 0, -1, -2].map((p) => ({ p, pos: stationAxisAnchor(focus, p) })) : []),
    [focus],
  );
  const hoverMark = hovered ? marks.find((m) => m.key === hovered) : undefined;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-label="Scene labels">
      {STATIONS.map((s, i) => {
        const isFocus = focus === s.id;
        const dim = focus !== null && !isFocus;
        return (
          <div key={s.id} ref={anchorRef(`station-${s.id}`, stationAnchors[i])} className="absolute left-0 top-0 will-change-transform">
            <button
              type="button"
              onClick={() => setFocus(isFocus ? null : s.id)}
              aria-pressed={isFocus}
              title={s.rule}
              className={`pointer-events-auto -translate-y-full flex items-baseline gap-2 whitespace-nowrap rounded-md border px-2 py-1 text-[12px] backdrop-blur-md transition-[color,border-color,opacity] ${
                isFocus ? "border-accent/70 bg-accent-soft text-text" : "border-border bg-bg/70 text-text-2 hover:border-border-strong hover:text-text"
              } ${dim ? "opacity-45" : ""}`}
            >
              <span className="num text-text-muted">{i + 1}</span>
              <span>{s.label}</span>
              <span className="num text-text-muted">{counts[s.id] ?? 0}</span>
            </button>
          </div>
        );
      })}

      <div ref={anchorRef("tumor", TUMOR_ANCHOR)} className="absolute left-0 top-0 will-change-transform">
        <button
          type="button"
          onClick={() => setFocusTumor(!focusTumor)}
          aria-pressed={focusTumor}
          className="pointer-events-auto -translate-x-full -translate-y-full flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-bg/70 py-1 pl-2 pr-3 text-[12px] text-text-2 backdrop-blur-md transition-colors hover:border-border-strong hover:text-text"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-magenta" />
          Tumor hotspot
          <span className="text-text-muted">illustrative</span>
        </button>
      </div>

      {axisAnchors.map(({ p, pos }) => (
        <div key={`${focus}-${p}`} ref={anchorRef(`axis-${p}`, pos)} className="absolute left-0 top-0 will-change-transform">
          <span className="num block -translate-y-1/2 pl-1 text-[11px] text-text-muted">{signedPolarity(p)}</span>
        </div>
      ))}

      {hoverMark && hoverMark.visible && <MarkTooltip key={hoverMark.key} mark={hoverMark} />}
    </div>
  );
}

function MarkTooltip({ mark }: { mark: Mark }) {
  const a = mark.aspect;
  const d = markPositions.data;
  const pos = useMemo(
    () => new Vector3(d[mark.index * 3] ?? 0, (d[mark.index * 3 + 1] ?? 0) + 0.16, d[mark.index * 3 + 2] ?? 0),
    [d, mark.index],
  );
  return (
    <div ref={anchorRef("tooltip", pos)} className="absolute left-0 top-0 will-change-transform">
      <div role="tooltip" className="w-72 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-bg-elevated/95 px-3 py-2.5 shadow-[var(--shadow-panel)] backdrop-blur-md">
        <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
          <span className="num">{mark.item.item_id} · {mark.item.iso_week}</span>
          <span className="num text-[12px]" style={{ color: polarityCss(a.polarity) }}>{signedPolarity(a.polarity)}</span>
        </div>
        <p className="mt-1 line-clamp-3 text-[13px] leading-snug text-text">&ldquo;{a.span}&rdquo;</p>
        <p className="mt-1.5 text-[11.5px] text-text-2">
          {humanize(a.aspect)} · {a.speaker}{mark.excluded ? " · excluded" : ""} · click to open
        </p>
      </div>
    </div>
  );
}
