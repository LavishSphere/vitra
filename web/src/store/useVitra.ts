/**
 * The one store. Scenes and panels are pure views over it.
 * Filters, selection, exclusions and the evidence/trends/cards/gaps arrays all live here.
 */
import { create } from "zustand";
import type {
  AspectEvidence, AspectKey, EvidenceGap, EvidenceItem, InsightCard, IntakeResult, SignalType, Source,
  Speaker, TrendCell,
} from "@contract/types.ts";
import { dataSource } from "../data/index.ts";
import { weekSpan } from "../data/trends.ts";
import { weeksBetween } from "../lib/isoWeek.ts";
import { stationFor, type StationId } from "../data/stations.ts";
import { gapFocus } from "../lib/gapFocus.ts";
import { spanIsVerified } from "../data/spans.ts";
import { diffImpact, type Impact, type Snapshot } from "../lib/impact.ts";

export type ProductFilter = "A" | "B" | "all";

export interface Filters {
  product: ProductFilter;
  weekFrom: string;
  weekTo: string;
  speaker: Speaker | "all";
  aspect: AspectKey | "all";
  source: Source | "all";
  signalType: SignalType | "all";
}

/** One scene object: an (item, aspect) pair. Index is stable for the session. */
export interface Mark {
  index: number;
  key: string;
  item: EvidenceItem;
  aspect: AspectEvidence;
  station: StationId;
  visible: boolean;
  excluded: boolean;
}

export interface Selection { itemId: string; aspect?: AspectKey; }

export interface Pulse { id: number; itemId: string; aspect: AspectKey; station: StationId; week: string; polarity: number; startedAt: number; }

/** Seconds between station visits when an intake touches more than one station. */
export const TOUR_STEP_MS = 2600;

/** Everything needed to put the analysis back exactly as it was before an intake. */
export interface Baseline extends Snapshot {
  weeks: string[];
  filters: Filters;
  excluded: string[];
}

/** One incorporated transcript: what it added, the baseline before it, and what changed. */
export interface IntakeSession {
  itemId: string;
  result: IntakeResult;
  before: Baseline;
  impact: Impact;
  /** Distinct stations in visit order, with the time the pulse leaves for each. */
  tour: { station: StationId; startAt: number }[];
  cardsLive: boolean;
}

export type RailTab = "trends" | "cards" | "gaps" | "evidence";

/** Where the camera should be. "intake" moves come from a classified transcript, "user" from a click or key. */
export interface CameraFocus { stationId: StationId; reason: "intake" | "user"; }
export type ViewMode = "3d" | "2d";

interface VitraState {
  status: "loading" | "ready" | "error";
  error: string | null;
  sourceKind: "fixtures" | "api";
  sourceLabel: string;

  evidence: EvidenceItem[];
  trends: TrendCell[];
  cards: InsightCard[];
  gaps: EvidenceGap[];
  weeks: string[];
  marks: Mark[];

  filters: Filters;
  excluded: string[];
  selection: Selection | null;
  hovered: string | null; // mark key
  focusStation: StationId | null;
  /** Camera target. Kept in step with focusStation; the rig flies here. */
  cameraFocus: CameraFocus | null;
  focusTumor: boolean;
  /** Text panel for the tumor hotspot. Independent of focusTumor so Close can dismiss facts without leaving the zoom. */
  tumorCardOpen: boolean;
  view: ViewMode;
  railOpen: boolean;
  railTab: RailTab;
  intakeOpen: boolean;
  pulses: Pulse[];
  lastIntake: IntakeResult | null;
  /** The most recent incorporated transcript, until it is undone or replaced. */
  session: IntakeSession | null;
  recomputing: boolean;

  load(): Promise<void>;
  setFilter<K extends keyof Filters>(key: K, value: Filters[K]): void;
  /** Point the scene and the timeline at one gap cell. Stays on the current rail tab. */
  focusGap(gap: EvidenceGap): void;
  setWeekRange(from: string, to: string): void;
  resetFilters(): void;
  select(sel: Selection | null): void;
  hover(key: string | null): void;
  setFocusStation(s: StationId | null): void;
  /** Fly the camera to a station. Intake moves leave the rail tab alone. */
  focusCameraOn(id: StationId, reason?: CameraFocus["reason"]): void;
  /** Back to the overview. */
  clearFocus(): void;
  setFocusTumor(on: boolean): void;
  /** Show or hide the tumor facts card without changing the camera. */
  setTumorCardOpen(open: boolean): void;
  setView(v: ViewMode): void;
  setRail(open: boolean, tab?: RailTab): void;
  setIntakeOpen(open: boolean): void;
  toggleExclude(itemId: string): Promise<void>;
  resetExcluded(): Promise<void>;
  incorporate(result: IntakeResult, opts?: { tour?: boolean }): Promise<void>;
  /** Finish the station tour now: pulses land at once and the camera goes back to the overview. */
  skipTour(): void;
  /**
   * Remove the last incorporated transcript and restore the baseline exactly. If the source
   * could only clear every transcript ("all"), every pasted transcript is dropped and recomputed.
   */
  undoIntake(): Promise<"one" | "all">;
  /** Keep the transcript and close the session view. */
  dismissSession(): void;
}

const ALL_FILTERS = (weeks: string[]): Filters => ({
  product: "all",
  weekFrom: weeks[0] ?? "",
  weekTo: weeks[weeks.length - 1] ?? "",
  speaker: "all",
  aspect: "all",
  source: "all",
  signalType: "all",
});

export function matchesItem(item: EvidenceItem, f: Filters): boolean {
  if (f.product !== "all" && item.product !== f.product) return false;
  if (f.source !== "all" && item.source !== f.source) return false;
  if (f.signalType !== "all" && item.signal_type !== f.signalType) return false;
  if (f.weekFrom && item.iso_week < f.weekFrom) return false;
  if (f.weekTo && item.iso_week > f.weekTo) return false;
  return true;
}

export function matchesAspect(a: AspectEvidence, f: Filters): boolean {
  if (f.aspect !== "all" && a.aspect !== f.aspect) return false;
  if (f.speaker !== "all" && a.speaker !== f.speaker) return false;
  return true;
}

function buildMarks(evidence: EvidenceItem[], f: Filters, excluded: string[], prev: Mark[] = []): Mark[] {
  const ex = new Set(excluded);
  const prevIndex = new Map(prev.map((m) => [m.key, m.index]));
  let next = prev.length;
  const out: Mark[] = [];
  for (const item of evidence) {
    const itemOk = matchesItem(item, f);
    for (const a of item.aspects) {
      // Never draw a quote whose span doesn't sit at its offsets in the source text.
      if (!spanIsVerified(item.text, a)) continue;
      const key = `${item.item_id}:${a.aspect}`;
      const index = prevIndex.get(key) ?? next++;
      out.push({
        index, key, item, aspect: a, station: stationFor(a.aspect, a.speaker),
        visible: itemOk && matchesAspect(a, f), excluded: ex.has(item.item_id),
      });
    }
  }
  return out.sort((x, y) => x.index - y.index);
}

let pulseSeq = 0;

export const useVitra = create<VitraState>((set, get) => ({
  status: "loading",
  error: null,
  sourceKind: dataSource.kind,
  sourceLabel: dataSource.label,
  evidence: [],
  trends: [],
  cards: [],
  gaps: [],
  weeks: [],
  marks: [],
  filters: ALL_FILTERS([]),
  excluded: [],
  selection: null,
  hovered: null,
  focusStation: null,
  cameraFocus: null,
  focusTumor: false,
  tumorCardOpen: false,
  view: "3d",
  railOpen: false,
  railTab: "trends",
  intakeOpen: false,
  pulses: [],
  lastIntake: null,
  session: null,
  recomputing: false,

  async load() {
    try {
      const d = await dataSource.load();
      const span = weekSpan(d.evidence);
      const weeks = span ? weeksBetween(span[0], span[1]) : [];
      const filters = ALL_FILTERS(weeks);
      set({ status: "ready", ...d, weeks, filters, marks: buildMarks(d.evidence, filters, []) });
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },

  setFilter(key, value) {
    const filters = { ...get().filters, [key]: value };
    set({ filters, marks: buildMarks(get().evidence, filters, get().excluded, get().marks) });
  },

  focusGap(gap) {
    const patch = gapFocus(gap, get().weeks);
    const filters = { ...get().filters, ...patch };
    set({
      filters,
      marks: buildMarks(get().evidence, filters, get().excluded, get().marks),
      focusStation: stationFor(gap.aspect, gap.speaker),
      cameraFocus: { stationId: stationFor(gap.aspect, gap.speaker), reason: "user" },
      focusTumor: false,
      tumorCardOpen: false,
      selection: null,
    });
  },

  setWeekRange(from, to) {
    const [a, b] = from <= to ? [from, to] : [to, from];
    const filters = { ...get().filters, weekFrom: a, weekTo: b };
    set({ filters, marks: buildMarks(get().evidence, filters, get().excluded, get().marks) });
  },

  resetFilters() {
    const filters = ALL_FILTERS(get().weeks);
    set({ filters, marks: buildMarks(get().evidence, filters, get().excluded, get().marks) });
  },

  select(sel) { set({ selection: sel }); },
  hover(key) { if (get().hovered !== key) set({ hovered: key }); },
  setFocusStation(s) {
    set({
      focusStation: s,
      cameraFocus: s ? { stationId: s, reason: "user" } : null,
      focusTumor: false,
      tumorCardOpen: false,
      ...(s ? { railTab: "evidence" as RailTab } : {}),
    });
  },
  focusCameraOn(id, reason = "user") {
    set({
      focusStation: id,
      cameraFocus: { stationId: id, reason },
      focusTumor: false,
      tumorCardOpen: false,
      ...(reason === "user" ? { railTab: "evidence" as RailTab } : {}),
    });
  },
  clearFocus() { set({ focusStation: null, cameraFocus: null, focusTumor: false, tumorCardOpen: false }); },
  setFocusTumor(on) {
    const keep = on ? null : get().focusStation;
    set({
      focusTumor: on,
      // Entering the tumor opens the facts card; leaving the zoom dismisses it.
      tumorCardOpen: on,
      focusStation: keep,
      cameraFocus: keep ? get().cameraFocus : null,
    });
  },
  setTumorCardOpen(open) {
    if (!get().focusTumor && open) return;
    set({ tumorCardOpen: open });
  },
  setView(v) { set({ view: v }); },
  setRail(open, tab) { set({ railOpen: open, railTab: tab ?? get().railTab }); },
  setIntakeOpen(open) { set({ intakeOpen: open }); },

  async toggleExclude(itemId) {
    const cur = get().excluded;
    const excluded = cur.includes(itemId) ? cur.filter((x) => x !== itemId) : [...cur, itemId];
    await recompute(excluded);
  },

  /** "Reset to source data": no exclusions, no pasted transcripts. */
  async resetExcluded() {
    await dataSource.reset().catch(() => undefined);
    const s = get();
    const evidence = s.evidence.filter((e) => e.source !== "transcript");
    const span = weekSpan(evidence);
    const weeks = span ? weeksBetween(span[0], span[1]) : s.weeks;
    const filters = { ...s.filters, weekFrom: s.filters.weekFrom < weeks[0] ? weeks[0] : s.filters.weekFrom, weekTo: s.filters.weekTo > weeks[weeks.length - 1] ? weeks[weeks.length - 1] : s.filters.weekTo };
    set({ evidence, weeks, filters, pulses: [], lastIntake: null, session: null, marks: buildMarks(evidence, filters, [], s.marks) });
    await recompute([]);
  },

  async incorporate(result, opts = {}) {
    const ev = result.evidence;
    set({ lastIntake: result });
    if (!ev || ev.aspects.length === 0) return;
    const s0 = get();
    const before: Baseline = {
      evidence: s0.evidence, trends: s0.trends, cards: s0.cards, gaps: s0.gaps,
      weeks: s0.weeks, filters: s0.filters, excluded: s0.excluded,
    };
    const evidence = [...s0.evidence.filter((e) => e.item_id !== ev.item_id), ev];
    const span = weekSpan(evidence);
    const weeks = span ? weeksBetween(span[0], span[1]) : s0.weeks;
    const f = s0.filters;
    // Extend the week window if the new item sits past the current end, so it is visible.
    const filters = { ...f, weekTo: f.weekTo === s0.weeks[s0.weeks.length - 1] ? weeks[weeks.length - 1] : f.weekTo };
    set({ evidence, weeks, filters, marks: buildMarks(evidence, filters, s0.excluded, s0.marks) });
    await recompute(s0.excluded);
    const s1 = get();
    const impact = diffImpact(before, { evidence: s1.evidence, trends: s1.trends, cards: s1.cards, gaps: s1.gaps });

    // One stop per affected station, in the order the aspects came back.
    const now = performance.now();
    const step = opts.tour === false ? 0 : TOUR_STEP_MS;
    const tour: IntakeSession["tour"] = [];
    for (const a of ev.aspects) {
      const station = stationFor(a.aspect, a.speaker);
      if (!tour.some((t) => t.station === station)) tour.push({ station, startAt: now + tour.length * step });
    }
    const pulses = ev.aspects.map((a) => {
      const station = stationFor(a.aspect, a.speaker);
      return {
        id: ++pulseSeq, itemId: ev.item_id, aspect: a.aspect, station, week: ev.iso_week, polarity: a.polarity,
        startedAt: tour.find((t) => t.station === station)!.startAt,
      };
    });
    set({
      pulses: [...s1.pulses.filter((p) => now - p.startedAt < 4000), ...pulses],
      session: { itemId: ev.item_id, result, before, impact, tour, cardsLive: dataSource.cardsLive },
    });
  },

  skipTour() {
    const s = get();
    if (!s.session) return;
    const done = performance.now() - 10_000;
    set({
      pulses: s.pulses.map((p) => (p.itemId === s.session!.itemId ? { ...p, startedAt: done } : p)),
      session: { ...s.session, tour: s.session.tour.map((t) => ({ ...t, startAt: done })) },
      focusStation: null, cameraFocus: null,
    });
  },

  async undoIntake() {
    const s = get();
    const sess = s.session;
    if (!sess) return "one";
    const scope = await dataSource.undo(sess.itemId);
    const b = sess.before;
    if (scope === "all") {
      // The source dropped every held transcript, so the baseline's earlier transcripts are gone
      // too. Match the source: drop them here and recompute instead of restoring the snapshot.
      const evidence = b.evidence.filter((e) => e.source !== "transcript");
      const span = weekSpan(evidence);
      const weeks = span ? weeksBetween(span[0], span[1]) : b.weeks;
      const clamp = (w: string) => (w < weeks[0] ? weeks[0] : w > weeks[weeks.length - 1] ? weeks[weeks.length - 1] : w);
      const filters = { ...b.filters, weekFrom: clamp(b.filters.weekFrom), weekTo: clamp(b.filters.weekTo) };
      set({ evidence, weeks, filters, marks: buildMarks(evidence, filters, b.excluded, s.marks), pulses: [], selection: null });
      await recompute(b.excluded);
      // The session closes only once the recomputed numbers are on screen.
      set({ session: null, lastIntake: null, focusStation: null, cameraFocus: null });
      return scope;
    }
    set({
      evidence: b.evidence, trends: b.trends, cards: b.cards, gaps: b.gaps,
      weeks: b.weeks, filters: b.filters, excluded: b.excluded,
      marks: buildMarks(b.evidence, b.filters, b.excluded, s.marks),
      pulses: s.pulses.filter((p) => p.itemId !== sess.itemId),
      selection: s.selection?.itemId === sess.itemId ? null : s.selection,
      session: null, lastIntake: null, focusStation: null, cameraFocus: null,
    });
    return scope;
  },

  dismissSession() { set({ session: null }); },
}));

async function recompute(excluded: string[]) {
  const s = useVitra.getState();
  useVitra.setState({ excluded, recomputing: true, marks: buildMarks(s.evidence, s.filters, excluded, s.marks) });
  try {
    const r = await dataSource.whatIf(excluded, s.evidence);
    useVitra.setState({
      trends: r.trends,
      ...(r.cards ? { cards: r.cards } : {}),
      ...(r.gaps ? { gaps: r.gaps } : {}),
      recomputing: false,
    });
  } catch (e) {
    useVitra.setState({ recomputing: false, error: e instanceof Error ? e.message : String(e) });
  }
}

export const selectVisibleMarks = (s: VitraState) => s.marks.filter((m) => m.visible);
