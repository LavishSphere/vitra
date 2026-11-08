/**
 * Guided experience actions. Each one calls a scene move the interface already uses:
 * tumor focus, selecting a mark (See the quote), or the sample note on the intake card.
 */
import type { Mark } from "../store/useVitra.ts";
import { useVitra } from "../store/useVitra.ts";
import { useArrival } from "../scene/arrival.ts";
import { openDiveFrom } from "../scene/cell/store.ts";

export const GUIDED_ENTRY = "Experience Vitra";
export const GUIDED_TITLE = "Suggested guided experience";
export const GUIDED_TIME = "45 seconds";
export const GUIDED_FOOTER = "Uses the same scene moves as a normal click.";

export const GUIDED_STEPS = [
  {
    id: "lung",
    title: "Explore the lung",
    body: "Fly into the tumor hotspot and view the selected therapy's molecular mechanism.",
  },
  {
    id: "evidence",
    title: "Investigate real-world evidence",
    body: "Move toward a safety-related evidence mark, then reveal the exact source quotation.",
  },
  {
    id: "intake",
    title: "Watch the intelligence change",
    body: "Load the sample transcript and show affected stations.",
  },
] as const;

export type GuidedStepId = (typeof GUIDED_STEPS)[number]["id"];

/** First safety mark a normal click could hit: on screen, and not excluded. */
export function firstSafetyMark(marks: Mark[]): Mark | undefined {
  return marks.find((m) => m.visible && !m.excluded && m.aspect.aspect === "safety");
}

/**
 * Same as clicking a safety dot. If the current aspect filter hides them, switch to safety
 * and take the first mark that appears. Opens See the quote.
 */
export function selectSafetyEvidence(): boolean {
  let mark = firstSafetyMark(useVitra.getState().marks);
  if (!mark && useVitra.getState().filters.aspect !== "safety") {
    useVitra.getState().setFilter("aspect", "safety");
    mark = firstSafetyMark(useVitra.getState().marks);
  }
  if (!mark) return false;
  useVitra.getState().select({ itemId: mark.item.item_id, aspect: mark.aspect.aspect });
  useArrival.getState().engage();
  return true;
}

/**
 * First click flies to the tumor and opens its facts. A later click, once that zoom is on,
 * opens the receptor dive from the button that was pressed.
 */
export function exploreLung(origin: Element | null): void {
  const s = useVitra.getState();
  useArrival.getState().engage();
  if (s.focusTumor) {
    openDiveFrom(origin);
    return;
  }
  s.setFocusTumor(true);
  s.setTumorCardOpen(true);
}

type SampleRun = () => void | Promise<void>;
let sampleRun: SampleRun | null = null;

/** IntakePanel registers the same path as "Use a sample note", then its analyze step. */
export function registerSampleIntake(fn: SampleRun): () => void {
  sampleRun = fn;
  return () => {
    if (sampleRun === fn) sampleRun = null;
  };
}

export function runSampleIntake(): void {
  void sampleRun?.();
}
