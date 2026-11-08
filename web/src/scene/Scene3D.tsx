import { Observatory } from "./Observatory.tsx";
import { SceneLabels } from "../ui/SceneLabels.tsx";
import { LungPinLabels } from "./LungPins.tsx";
import { CellDive } from "./CellDive.tsx";

/** Lazy-loaded entry for everything three.js, so the 2D view and the chrome paint first. */
export default function Scene3D({ animate, railPx }: { animate: boolean; railPx: number }) {
  return (
    <>
      <Observatory animate={animate} railPx={railPx} />
      <SceneLabels />
      <LungPinLabels />
      <CellDive animate={animate} />
    </>
  );
}
