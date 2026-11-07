/**
 * Projected DOM labels. Labels are ordinary DOM in the main React tree (so they are
 * focusable and readable); one useFrame inside the canvas writes their screen transforms.
 */
import { Vector3 } from "three";

export interface Anchor { el: HTMLElement; pos: Vector3; lastX: number; lastY: number; hidden: boolean; }

export const anchors = new Map<string, Anchor>();

/** Ref-callback factory: `ref={anchorRef("id", position)}`. */
export function anchorRef(id: string, pos: Vector3) {
  return (el: HTMLElement | null) => {
    if (el) anchors.set(id, { el, pos, lastX: NaN, lastY: NaN, hidden: false });
    else anchors.delete(id);
  };
}

/** Mark world positions published by the evidence layer for tooltips and pulses. */
export const markPositions: { data: Float32Array } = { data: new Float32Array(0) };
