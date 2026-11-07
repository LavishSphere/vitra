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

export interface Pulse { id: number; itemId: string; station: StationId; week: string; polarity: number; startedAt: number; }

export type RailTab = "trends" | "cards" | "gaps" | "evidence";
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
  focusTumor: boolean;
  view: ViewMode;
  railOpen: boolean;
  railTab: RailTab;
  intakeOpen: boolean;
  pulses: Pulse[];
  lastIntake: IntakeResult | null;
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
  setFocusTumor(on: boolean): void;
  setView(v: ViewMode): void;
  setRail(open: boolean, tab?: RailTab): void;
  setIntakeOpen(open: boolean): void;
  toggleExclude(itemId: string): Promise<void>;
  resetExcluded(): Promise<void>;
  incorporate(result: IntakeResult): Promise<void>;
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
  focusTumor: false,
  view: "3d",
  railOpen: true,
  railTab: "trends",
  intakeOpen: false,
  pulses: [],
  lastIntake: null,
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
      focusTumor: false,
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
  setFocusStation(s) { set({ focusStation: s, focusTumor: false, ...(s ? { railTab: "evidence" as RailTab } : {}) }); },
  setFocusTumor(on) { set({ focusTumor: on, focusStation: on ? null : get().focusStation }); },
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
    set({ evidence, weeks, filters, pulses: [], lastIntake: null, marks: buildMarks(evidence, filters, [], s.marks) });
    await recompute([]);
  },

  async incorporate(result) {
    const ev = result.evidence;
    set({ lastIntake: result });
    if (!ev || ev.aspects.length === 0) return;
    const evidence = [...get().evidence.filter((e) => e.item_id !== ev.item_id), ev];
    const span = weekSpan(evidence);
    const weeks = span ? weeksBetween(span[0], span[1]) : get().weeks;
    const f = get().filters;
    // Extend the week window if the new item sits past the current end, so it is visible.
    const filters = { ...f, weekTo: f.weekTo === get().weeks[get().weeks.length - 1] ? weeks[weeks.length - 1] : f.weekTo };
    set({ evidence, weeks, filters, marks: buildMarks(evidence, filters, get().excluded, get().marks) });
    await recompute(get().excluded);
    const now = performance.now();
    const pulses = ev.aspects.map((a) => ({
      id: ++pulseSeq, itemId: ev.item_id, station: stationFor(a.aspect, a.speaker), week: ev.iso_week, polarity: a.polarity, startedAt: now,
    }));
    set({ pulses: [...get().pulses.filter((p) => now - p.startedAt < 4000), ...pulses] });
  },
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
