import { Observatory } from "./Observatory.tsx";
import { SceneLabels } from "../ui/SceneLabels.tsx";
import { LungPinLabels } from "./LungPins.tsx";
import { CellDive } from "./CellDive.tsx";
import { LensBar, RingReadout } from "../ui/LensLegend.tsx";
import { EvidencePanel } from "../ui/EvidencePanel.tsx";
import { useVitra } from "../store/useVitra.ts";

/** Lazy-loaded entry for everything three.js, so the 2D view and the chrome paint first. */
export default function Scene3D({ animate, railPx }: { animate: boolean; railPx: number }) {
  const dive = useVitra((s) => (s.cameraFocus?.kind === "evidence" ? s.cameraFocus : null));
  return (
    <>
      <Observatory animate={animate} railPx={railPx} />
      <SceneLabels />
      <LungPinLabels />
      <CellDive animate={animate} />
      <div className="pointer-events-none absolute inset-0 overflow-hidden"><RingReadout hidden={dive !== null} /></div>
      <EvidencePanel
        target={dive}
        onStep={(t) => useVitra.getState().diveTo(t.itemId, t.aspect)}
        onExit={() => useVitra.getState().clearFocus()}
        onOpenXRay={(t) => useVitra.getState().select(t)}
      />
      <div className="pointer-events-none absolute top-4 z-10 transition-[right] duration-500" style={{ right: railPx + 16 }}><LensBar /></div>
    </>
  );
}
