import { useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { anchors } from "./labels.ts";

export function LabelProjector() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new Vector3(), []);
  useFrame(() => {
    for (const a of anchors.values()) {
      v.copy(a.pos).project(camera);
      const behind = v.z > 1 || v.z < -1;
      if (behind !== a.hidden) {
        a.el.style.visibility = behind ? "hidden" : "visible";
        a.hidden = behind;
      }
      if (behind) continue;
      const x = Math.round((v.x * 0.5 + 0.5) * size.width);
      const y = Math.round((-v.y * 0.5 + 0.5) * size.height);
      if (x !== a.lastX || y !== a.lastY) {
        a.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        a.lastX = x;
        a.lastY = y;
      }
    }
  });
  return null;
}
