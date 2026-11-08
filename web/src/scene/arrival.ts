/**
 * First-look state. While `arriving`, the camera pushes in toward the lungs. Until `engaged`
 * (first click, key or station visit), the chrome stays quiet: filters folded, report closed,
 * legend folded to a button.
 */
import { create } from "zustand";
import { useVitra } from "../store/useVitra.ts";

interface ArrivalState {
  arriving: boolean;
  engaged: boolean;
  /** Ends the camera push now. The rig snaps to the overview on its next frame. */
  skip(): void;
  /** Called by the rig when the push finishes on its own. */
  finish(): void;
  engage(): void;
}

export const useArrival = create<ArrivalState>((set, get) => ({
  arriving: true,
  engaged: false,
  skip() { if (get().arriving) set({ arriving: false }); },
  finish() { if (get().arriving) set({ arriving: false }); },
  engage() {
    if (get().engaged) return;
    set({ engaged: true, arriving: false });
    // Open the report on the first real interaction, unless on a narrow screen.
    const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
    if (!narrow) useVitra.getState().setRail(true);
  },
}));

// Anything that changes what the scene shows counts as engagement.
useVitra.subscribe((s, prev) => {
  if (useArrival.getState().engaged) return;
  if (
    (s.focusStation && s.focusStation !== prev.focusStation)
    || (s.focusTumor && !prev.focusTumor)
    || (s.selection && s.selection !== prev.selection)
    // A filter change by the person (a reload replaces the evidence too, so it doesn't count).
    || (s.filters !== prev.filters && prev.status === "ready" && s.evidence === prev.evidence)
    || s.intakeOpen && !prev.intakeOpen
    || (s.railOpen && !prev.railOpen)
  ) {
    useArrival.getState().engage();
  }
});
