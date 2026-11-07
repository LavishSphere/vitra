import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Color } from "three";
import { useVitra } from "../store/useVitra.ts";
import { floorMaterial } from "./materials.ts";
import { accentFor, breathAt } from "./Lungs.tsx";
import { FLOOR_Y } from "./framing.ts";

/** The observatory floor: a pool of accent light under the lungs that falls off into the dark. */
export function Floor({ animate }: { animate: boolean }) {
  const mat = useMemo(() => floorMaterial(accentFor("all", new Color())), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const product = useVitra((s) => s.filters.product);
  const focused = useVitra((s) => s.focusStation !== null);
  const target = useMemo(() => new Color(), []);
  useFrame((state, dt) => {
    const k = 1 - Math.exp(-dt * 3);
    (mat.uniforms.uAccent.value as Color).lerp(accentFor(product, target), k);
    mat.uniforms.uBreath.value = animate ? breathAt(state.clock.elapsedTime) : 0.35;
    const f = mat.uniforms.uFocus;
    f.value += ((focused ? 1 : 0) - f.value) * k;
  });
  return (
    <mesh material={mat} position={[0, FLOOR_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
      <planeGeometry args={[30, 30]} />
    </mesh>
  );
}
