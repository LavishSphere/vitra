import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { useVitra } from "./store/useVitra.ts";
import { TopBar } from "./ui/TopBar.tsx";
import { DemoBanner } from "./ui/DemoBanner.tsx";
import { Rail, RAIL_WIDTH } from "./ui/Rail.tsx";
import { Timeline } from "./ui/Timeline.tsx";
import { XRay } from "./ui/XRay.tsx";
import { IntakePanel } from "./ui/IntakePanel.tsx";
import { Flat2D } from "./ui/Flat2D.tsx";
import { SceneOverlay } from "./ui/SceneOverlay.tsx";
import { STATIONS } from "./data/stations.ts";

const Scene3D = lazy(() => import("./scene/Scene3D.tsx"));

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const fn = () => setOn(m.matches);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, [query]);
  return on;
}

/** If the 3D scene throws (lost context, driver bug), fall back to the 2D view. */
class SceneBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function App() {
  const load = useVitra((s) => s.load);
  const status = useVitra((s) => s.status);
  const error = useVitra((s) => s.error);
  const view = useVitra((s) => s.view);
  const setView = useVitra((s) => s.setView);
  const railOpen = useVitra((s) => s.railOpen);
  const product = useVitra((s) => s.filters.product);
  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const narrow = useMedia("(max-width: 767px)");
  const [gl] = useState(webglAvailable);
  const [glFailed, setGlFailed] = useState(false);

  useEffect(() => { void load(); }, [load]);
  // WebGL missing or reduced motion: start in the 2D view. People can still switch.
  useEffect(() => { if (!gl || reducedMotion) setView("2d"); }, [gl, reducedMotion, setView]);
  useEffect(() => { document.documentElement.dataset.product = product; }, [product]);
  useEffect(() => { if (narrow) useVitra.getState().setRail(false); }, [narrow]);

  useKeyboardShortcuts();

  const is3d = view === "3d" && gl && !glFailed;
  const railPx = railOpen && !narrow ? RAIL_WIDTH : 0;

  return (
    <div className="fixed inset-0 flex flex-col">
      <a href="#report" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[60] focus:rounded focus:bg-bg-elevated focus:px-3 focus:py-1.5">Skip to the report</a>
      <DemoBanner />
      <TopBar />
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0">
          {status === "ready" && is3d && (
            <SceneBoundary onFail={() => { setGlFailed(true); setView("2d"); }}>
              <Suspense fallback={<p className="absolute inset-0 grid place-items-center text-[13px] text-text-muted">Loading the 3D scene</p>}>
                <Scene3D animate={!reducedMotion} railPx={railPx} />
              </Suspense>
            </SceneBoundary>
          )}
          {status === "ready" && !is3d && <Flat2D railPx={railPx} />}
          {status === "loading" && <p className="absolute inset-0 grid place-items-center text-[13px] text-text-muted">Loading evidence</p>}
          {status === "error" && <p className="absolute inset-0 grid place-items-center text-[13px] text-text-2">Couldn't load evidence: {error}</p>}
        </div>
        <div className="pointer-events-none absolute inset-0 transition-[right] duration-500" style={{ right: railPx }}>
          {status === "ready" && <SceneOverlay is3d={is3d} />}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg via-bg/85 to-transparent pt-8">
            {status === "ready" && <Timeline />}
          </div>
        </div>
        <div id="report">{status === "ready" && <Rail />}</div>
      </main>
      <XRay />
      <IntakePanel />
      {glFailed && <p className="sr-only" role="status">3D view unavailable. Showing the 2D view.</p>}
    </div>
  );
}

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useVitra.getState();
      // A dialog that handled the key (quote panel or dive Esc) keeps the scene where it is.
      if (e.defaultPrevented || s.selection) return;
      const el = e.target instanceof Element ? e.target : null;
      if ((el && el.closest("input, textarea, [role=listbox], [role=slider]")) || e.metaKey || e.ctrlKey || e.altKey) return;
      // Escape closes the tumor facts card first; key 0 (and Escape with no card) leave the zoom.
      if (e.key === "Escape" && s.tumorCardOpen) { s.setTumorCardOpen(false); return; }
      if (e.key === "0" || e.key === "Escape") { s.clearFocus(); }
      const n = Number(e.key);
      if (n >= 1 && n <= STATIONS.length) s.setFocusStation(STATIONS[n - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
