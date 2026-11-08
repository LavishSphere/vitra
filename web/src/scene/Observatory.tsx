import { useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { AdaptiveDpr, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Lungs } from "./Lungs.tsx";
import { Floor } from "./Stage.tsx";
import { Stations } from "./Stations.tsx";
import { Evidence } from "./Evidence.tsx";
import { CameraRig } from "./CameraRig.tsx";
import { Pulses } from "./Pulses.tsx";
import { LabelProjector } from "./LabelProjector.tsx";
import { LensGhosts, SpectralRing } from "./SpectralRing.tsx";
import { EvidenceDive } from "./EvidenceDive.tsx";
import { ARRIVAL_START } from "./framing.ts";
import { OVERVIEW } from "./layout.ts";
import { useVitra } from "../store/useVitra.ts";
import { useCellDive } from "./cell/store.ts";

/** Reports frames per second to window.__vitraFps (read by the perf check script). */
function FpsProbe() {
  const acc = useRef({ frames: 0, t0: performance.now() });
  useFrame(() => {
    const a = acc.current;
    a.frames++;
    const now = performance.now();
    if (now - a.t0 >= 1000) {
      (window as unknown as { __vitraFps: number }).__vitraFps = Math.round((a.frames * 1000) / (now - a.t0));
      a.frames = 0;
      a.t0 = now;
    }
  });
  return null;
}

export function Observatory({ animate, railPx }: { animate: boolean; railPx: number }) {
  const [dpr, setDpr] = useState(1.5);
  const deselect = useVitra((s) => s.setFocusTumor);
  // The cell dive covers the observatory with its own canvas, so stop drawing this one meanwhile.
  const covered = useCellDive((s) => s.covering);
  const dive = useVitra((s) => (s.cameraFocus?.kind === "evidence" ? s.cameraFocus : null));
  const homeOnExit = useVitra((s) => s.focusStation === null && !s.focusTumor);

  return (
    <Canvas
      dpr={[1, Math.min(2, dpr)]}
      gl={{ antialias: false, powerPreference: "high-performance", alpha: false, stencil: false }}
      camera={{ fov: 34, near: 0.1, far: 120, position: (animate ? ARRIVAL_START : OVERVIEW).position.toArray() }}
      frameloop={covered ? "never" : "always"}
      onPointerMissed={() => deselect(false)}
      aria-label="Interactive 3D lung observatory"
    >
      <color attach="background" args={["#0a0e17"]} />
      <PerformanceMonitor onIncline={() => setDpr(2)} onDecline={() => setDpr(1)} flipflops={3} />
      <AdaptiveDpr />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={3.2}
        maxDistance={50}
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI * 0.62}
        target={(animate ? ARRIVAL_START : OVERVIEW).target.toArray()}
        rotateSpeed={0.6}
        zoomSpeed={0.8}
      />
      <CameraRig animate={animate} railPx={railPx} />
      <Floor animate={animate} />
      <Lungs animate={animate} />
      <Stations animate={animate} />
      <Evidence animate={animate} />
      <LensGhosts />
      <SpectralRing animate={animate} dim={dive !== null} />
      <EvidenceDive target={dive} animate={animate} homeOnExit={homeOnExit} />
      <Pulses />
      <FpsProbe />
      <LabelProjector />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={0.85} luminanceSmoothing={0.2} intensity={0.85} radius={0.72} />
        <Vignette offset={0.32} darkness={0.62} />
      </EffectComposer>
    </Canvas>
  );
}
