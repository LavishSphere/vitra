/**
 * "What changed" after an intake. Every number is a diff of two snapshots that came from the
 * same trend, card and gap functions (lib/impact.ts). Every row opens the new quote in the source panel.
 */
import { useState } from "react";
import type { AspectKey } from "@contract/types.ts";
import { useVitra, type IntakeSession } from "../store/useVitra.ts";
import { impactSummary } from "../lib/impact.ts";
import { ASPECT_LABEL, PRODUCT_LABEL, SPEAKER_LABEL } from "./options.ts";
import { signedPolarity } from "../lib/format.ts";
import { polarityCss } from "../theme.ts";
import { shortWeek } from "../lib/isoWeek.ts";

function Mean({ value }: { value: number | null }) {
  if (value === null) return <span className="text-text-muted">none</span>;
  return <span style={{ color: polarityCss(value) }}>{signedPolarity(value, 2)}</span>;
}

function Row({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="group flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-bg-hover"
      >
        {children}
      </button>
    </li>
  );
}

export function ImpactCard({ session, onUndone, onKeep }: { session: IntakeSession; onUndone: (message: string) => void; onKeep: () => void }) {
  const select = useVitra((s) => s.select);
  const undo = useVitra((s) => s.undoIntake);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { impact, itemId } = session;
  const summary = impactSummary(impact);
  const open = (aspect?: AspectKey, id = itemId) => select({ itemId: id, aspect });
  const newCards = impact.cards.filter((c) => c.kind !== "removed");

  const doUndo = async () => {
    setBusy(true);
    setErr(null);
    try {
      const scope = await undo();
      const n = impact.cells.length;
      onUndone(scope === "one"
        ? `Undone. The note is gone and ${n} trend cell${n === 1 ? " is" : "s are"} back to where they were.`
        : "Undone. This backend can only clear all pasted notes at once, so every pasted note was removed and the numbers were recomputed from the source data.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p role="status" aria-live="polite" className="rise-in text-[13px] leading-relaxed text-text">{summary}</p>

      {impact.cells.length > 0 && (
        <section className="mt-3" aria-label="Trend cells that changed">
          <h3 className="mb-1 flex justify-between px-2 text-[11.5px] text-text-muted">
            <span>Trend cell</span>
            <span>mean and N, before to after</span>
          </h3>
          <ul>
            {impact.cells.map((c) => (
              <Row
                key={c.key}
                onClick={() => open(c.aspect, c.added[0] ?? itemId)}
                label={`${PRODUCT_LABEL[c.product]}, ${SPEAKER_LABEL[c.speaker]} on ${ASPECT_LABEL[c.aspect]}, ${c.week}. Mean ${signedPolarity(c.meanBefore, 2)} to ${signedPolarity(c.meanAfter, 2)}, N ${c.nBefore} to ${c.nAfter}. Open the quote.`}
              >
                <span className="min-w-0">
                  <span className="text-text">{ASPECT_LABEL[c.aspect]}</span>
                  <span className="text-text-muted"> · {SPEAKER_LABEL[c.speaker]}</span>
                  <span className="block text-[11.5px] text-text-muted">{PRODUCT_LABEL[c.product]}, week {shortWeek(c.week)}</span>
                </span>
                <span className="num shrink-0 whitespace-nowrap text-[12px]">
                  <Mean value={c.meanBefore} /> <span className="text-text-muted">N{c.nBefore}</span>
                  <span className="mx-1 text-text-muted" aria-hidden>&rarr;</span>
                  <Mean value={c.meanAfter} /> <span className="text-text-muted">N{c.nAfter}</span>
                </span>
              </Row>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-3" aria-label="Insight cards">
        <h3 className="mb-1 px-2 text-[11.5px] text-text-muted">Insight cards</h3>
        {newCards.length > 0 ? (
          <ul>
            {newCards.map((c) => {
              const cite = c.card.citations.find((x) => x.item_id === itemId) ?? c.card.citations[0];
              return (
                <Row key={c.id} onClick={() => open(cite?.aspect, cite?.item_id ?? itemId)} label={`${c.kind === "new" ? "New card" : "Updated card"}: ${c.card.headline}. Open the quote.`}>
                  <span className="min-w-0 text-text">{c.card.headline}</span>
                  <span className="shrink-0 text-[11.5px] text-text-muted">{c.kind === "new" ? "new" : `updated ${c.fields.join(", ").replace(/_/g, " ")}`}</span>
                </Row>
              );
            })}
          </ul>
        ) : (
          <p className="px-2 text-[12px] leading-relaxed text-text-2">
            {session.cardsLive
              ? "No card changed. Cards come from actionable items and week-over-week shifts, and this note made neither."
              : "Cards on this page are stored with the demo data and don't recompute. The laptop build recomputes them after every note."}
          </p>
        )}
      </section>

      <section className="mt-3" aria-label="Evidence gaps">
        <h3 className="mb-1 px-2 text-[11.5px] text-text-muted">Evidence gaps</h3>
        {impact.gapsClosed.length > 0 || impact.gapsOpened.length > 0 ? (
          <ul>
            {impact.gapsClosed.map((g) => (
              <Row
                key={`c-${g.product}-${g.speaker}-${g.aspect}`}
                onClick={() => open(g.aspect)}
                label={`Gap closed: ${SPEAKER_LABEL[g.speaker]} on ${PRODUCT_LABEL[g.product]} ${ASPECT_LABEL[g.aspect]}. Open the quote.`}
              >
                <span className="min-w-0 text-text">
                  {SPEAKER_LABEL[g.speaker]} on {ASPECT_LABEL[g.aspect].toLowerCase()}
                  <span className="block text-[11.5px] text-text-muted">
                    {PRODUCT_LABEL[g.product]}. {g.last_seen_week ? `Last heard in week ${shortWeek(g.last_seen_week)}` : "Never heard before"}, silent for {g.window_weeks} weeks.
                  </span>
                </span>
                <span className="shrink-0 text-[11.5px] text-cyan">closed</span>
              </Row>
            ))}
            {impact.gapsOpened.map((g) => (
              <li key={`o-${g.product}-${g.speaker}-${g.aspect}`} className="px-2 py-1.5 text-[12.5px] text-text-2">
                {SPEAKER_LABEL[g.speaker]} on {ASPECT_LABEL[g.aspect].toLowerCase()} ({PRODUCT_LABEL[g.product]}) is now a gap, because the window moved.
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 text-[12px] text-text-2">No gap closed or opened.</p>
        )}
      </section>

      {err && <p className="mt-3 text-[12.5px] text-magenta">Undo failed: {err}</p>}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void doUndo()}
          disabled={busy}
          className="rounded-lg border border-border-strong px-3 py-1.5 text-[13px] font-medium text-text transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-60"
        >
          {busy ? "Undoing" : "Undo this note"}
        </button>
        <button type="button" onClick={onKeep} className="whitespace-nowrap rounded-lg px-2 py-1.5 text-[13px] text-accent hover:text-accent-hover">
          Keep it
        </button>
      </div>
    </div>
  );
}
