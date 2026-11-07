/**
 * DOM labels for the cell view. Labels live in the overlay (plain, readable DOM); one useFrame
 * inside the cell canvas writes their screen transforms. Separate from the observatory anchors,
 * which use the other camera.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import { Vector3 } from "three";

interface CellAnchor { el: HTMLElement; pos: Vector3; lastX: number; lastY: number; }
const anchors = new Map<string, CellAnchor>();

/** Scene positions of the labels. The antibody entry is moved by the antibody as it settles. */
export const CELL_LABEL_POS = {
  egfr: new Vector3(-1.75, 1.7, 0),
  met: new Vector3(1.95, 1.35, 0),
  side: new Vector3(-4.6, 4.4, 0),
  antibody: new Vector3(0.45, 4.6, 0),
};

export function cellAnchor(id: string, pos: Vector3) {
  return (el: HTMLElement | null) => {
    if (el) anchors.set(id, { el, pos, lastX: NaN, lastY: NaN });
    else anchors.delete(id);
  };
}

export function CellLabelProjector() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new Vector3(), []);
  useFrame(() => {
    for (const a of anchors.values()) {
      v.copy(a.pos).project(camera);
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
