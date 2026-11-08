/** Cell-dive UI state, separate from the main store. */
import { create } from "zustand";
import type { CellProduct } from "./mechanisms.ts";

export interface DiveOrigin { x: number; y: number; }

interface CellDiveState {
  open: boolean;
  /** True once the overlay fully covers the observatory, so it can pause rendering. */
  covering: boolean;
  /** The dive animation is finished or was skipped. */
  arrived: boolean;
  product: CellProduct | null;
  origin: DiveOrigin | null;
  openDive(origin?: DiveOrigin | null, product?: CellProduct): void;
  closeDive(): void;
  setProduct(p: CellProduct): void;
  setCovering(on: boolean): void;
  arrive(): void;
}

export const useCellDive = create<CellDiveState>((set) => ({
  open: false,
  covering: false,
  arrived: false,
  product: null,
  origin: null,
  openDive(origin = null, product) { set({ open: true, arrived: false, covering: false, origin, ...(product ? { product } : {}) }); },
  closeDive() { set({ open: false, covering: false, arrived: false }); },
  setProduct(p) { set({ product: p }); },
  setCovering(on) { set({ covering: on }); },
  arrive() { set({ arrived: true }); },
}));

/** Open the dive from a DOM element (a keyboard press on a button), centered on it. */
export function openDiveFrom(el: Element | null, product?: CellProduct) {
  const r = el?.getBoundingClientRect();
  useCellDive.getState().openDive(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null, product);
}
