import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { Color, Mesh } from "three";
import { TUMOR_POSITION } from "./anatomy.ts";
import { haloMaterial, tumorMaterial } from "./materials.ts";
import { theme } from "./colors.ts";
import { useVitra } from "../store/useVitra.ts";
import { useCellDive } from "./cell/store.ts";

/**
 * Illustrative tumor hotspot. Its look never changes with sentiment or evidence: biology is a
 * static explanatory layer here.
 */
export function Tumor({ animate }: { animate: boolean }) {
  const core = useRef<Mesh>(null);
  const [hover, setHover] = useState(false);
  const focusTumor = useVitra((s) => s.focusTumor);

  const mag = theme().magenta;
  const coreMat = useMemo(() => tumorMaterial(new Color().copy(mag).multiplyScalar(1.15)), [mag]);
  const halo = useMemo(() => haloMaterial(mag, 0.9), [mag]);
  const ring = useMemo(() => haloMaterial(new Color("#F2F7FA"), 0.0), []);
  useEffect(() => () => { coreMat.dispose(); halo.dispose(); ring.dispose(); }, [coreMat, halo, ring]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (animate) coreMat.uniforms.uTime.value = t;
    const want = hover || focusTumor ? 1.35 : 1;
    const g = coreMat.uniforms.uGain;
    g.value += (want - g.value) * 0.12;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // Two steps: first click zooms + facts card; second opens the cell dive.
    if (!useVitra.getState().focusTumor) {
      useVitra.getState().setFocusTumor(true);
      return;
    }
    useCellDive.getState().openDive({ x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
  };

  return (
    <group position={TUMOR_POSITION}>
      <mesh
        ref={core}
        onClick={onClick}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ""; }}
      >
        <icosahedronGeometry args={[0.15, 5]} />
        <primitive object={coreMat} attach="material" />
      </mesh>
      <Billboard>
        <mesh material={halo} renderOrder={4}>
          <planeGeometry args={[1.25, 1.25]} />
        </mesh>
        <mesh material={ring} visible={false}>
          <planeGeometry args={[0.1, 0.1]} />
        </mesh>
      </Billboard>
    </group>
  );
}
