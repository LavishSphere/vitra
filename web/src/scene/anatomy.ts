/**
 * Procedural, stylized lung anatomy. Illustrative only: proportions are tuned for legibility,
 * not anatomical accuracy. Everything is built once at load; nothing here runs per frame.
 *
 * World frame: the patient faces the viewer (+z). Patient right = world -x.
 */
import {
  BufferAttribute, BufferGeometry, Float32BufferAttribute, QuadraticBezierCurve3, SphereGeometry,
  TubeGeometry, Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Small deterministic PRNG so the tree is identical on every load. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const LUNG = {
  medialOffset: 0.98,
  scale: new Vector3(1.15, 1.9, 1.25),
  yShift: -1.0,
};

/** Map a unit-sphere point to the lung surface in lung-local space (+x = lateral). */
function shapePoint(x: number, y: number, z: number, left: boolean): [number, number, number] {
  const up = y > 0;
  let sy = up ? y * 1.55 : y * 0.55;
  const taper = up ? 1 - 0.38 * y : 1;
  let sx = x * taper;
  let sz = z * taper;

  // Broad base with a shallow diaphragm dome and a lower lateral edge.
  if (!up) {
    const rr = Math.min(1, x * x + z * z);
    sy += 0.32 * (1 - rr) * -y;
    if (x > 0) sy -= 0.16 * x * -y;
  }
  // Flatter medial face, with the hilum/heart impression.
  if (sx < 0) {
    sx *= 0.55;
    const hilum = Math.exp(-((sy + 0.05) ** 2) / 0.32) * Math.exp(-(sz * sz) / 0.45);
    sx += 0.2 * hilum * -x;
    if (left) {
      // Cardiac notch: the left lung gives way to the heart, low and to the front.
      const notch = Math.exp(-((sy + 0.38) ** 2) / 0.22) * Math.exp(-((sz - 0.35) ** 2) / 0.25);
      sx += 0.34 * notch * -x;
    }
  }
  // Rounder back, slimmer front.
  sz *= sz < 0 ? 0.95 : 0.78;

  // Gentle organic undulation.
  const n = 0.022 * Math.sin(3.1 * x + 2.3 * y) * Math.sin(3.7 * z + 1.1) + 0.012 * Math.sin(7.0 * y + 2.0 * z);
  const len = Math.hypot(sx, sy, sz) || 1;
  sx += (sx / len) * n;
  sy += (sy / len) * n;
  sz += (sz / len) * n;
  return [sx, sy, sz];
}

export function lungGeometry(side: "right" | "left"): BufferGeometry {
  const left = side === "left";
  const g = new SphereGeometry(1, 128, 96);
  const pos = g.attributes.position as BufferAttribute;
  const sign = left ? 1 : -1;
  const widthScale = left ? 0.94 : 1;
  const heightScale = left ? 0.97 : 1;
  for (let i = 0; i < pos.count; i++) {
    const [sx, sy, sz] = shapePoint(pos.getX(i), pos.getY(i), pos.getZ(i), left);
    const wx = sign * (LUNG.medialOffset + sx * LUNG.scale.x * widthScale);
    const wy = sy * LUNG.scale.y * heightScale + LUNG.yShift;
    const wz = sz * LUNG.scale.z;
    pos.setXYZ(i, wx, wy, wz);
  }
  if (!left) {
    // Mirroring flips triangle winding; swap index order so normals face outward.
    const idx = g.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Rough interior test used to keep airway branches inside each lung. */
function insideLung(p: Vector3, side: -1 | 1): boolean {
  const cx = side * 1.22;
  const cy = -0.15;
  const ry = 1.85;
  const ny = (p.y - cy) / ry;
  const rx = 0.72 * (ny > 0 ? 1 - 0.42 * ny : 1);
  const rz = 0.78 * (ny > 0 ? 1 - 0.35 * ny : 1);
  const nx = (p.x - cx) / rx;
  const nz = (p.z + 0.04) / rz;
  return nx * nx + ny * ny + nz * nz < 1;
}

export interface Segment { a: Vector3; b: Vector3; c: Vector3; r: number; depth: number; parent: number; }

export interface AirwayTree {
  segments: Segment[];
  leaves: number[]; // segment indices of terminal branches
}

const tmpAxis = new Vector3();

function rotateAround(v: Vector3, axis: Vector3, angle: number): Vector3 {
  return v.clone().applyAxisAngle(axis, angle);
}

export function airwayTree(seed = 7, maxDepth = 7): AirwayTree {
  const rand = mulberry32(seed);
  const segments: Segment[] = [];
  const leaves: number[] = [];

  const add = (a: Vector3, b: Vector3, r: number, depth: number, parent: number, prevDir?: Vector3) => {
    const len = a.distanceTo(b);
    const c = prevDir
      ? a.clone().addScaledVector(prevDir, len * 0.45).lerp(a.clone().lerp(b, 0.5), 0.5)
      : a.clone().lerp(b, 0.5);
    segments.push({ a, b, c, r, depth, parent });
    return segments.length - 1;
  };

  const top = new Vector3(0, 2.75, -0.18);
  const carina = new Vector3(0, 1.05, -0.12);
  const trachea = add(top, carina, 0.115, 0, -1);

  const grow = (start: Vector3, dir: Vector3, len: number, r: number, depth: number, parent: number, side: -1 | 1, roll: Vector3) => {
    // Steer back toward the lung interior instead of pruning, so the tree fills the volume.
    const center = new Vector3(side * 1.25, -0.25 - depth * 0.04, 0);
    let end = start.clone().addScaledVector(dir, len);
    let tries = 0;
    while (!insideLung(end, side) && tries < 6) {
      const toC = center.clone().sub(start).normalize();
      dir = dir.clone().multiplyScalar(0.55).addScaledVector(toC, 0.45).normalize();
      len *= 0.86;
      end = start.clone().addScaledVector(dir, len);
      tries++;
    }
    if (!insideLung(end, side)) {
      if (parent >= 0 && depth > 2) leaves.push(parent);
      return;
    }
    const idx = add(start, end, r, depth, parent, dir);
    if (depth >= maxDepth) {
      leaves.push(idx);
      return;
    }
    // Next branching plane is roughly perpendicular to this one (as in real airways).
    const axis = tmpAxis.copy(roll).cross(dir).normalize().clone();
    const nextRoll = rotateAround(roll, dir, Math.PI / 2 + (rand() - 0.5) * 0.6);
    const major = 0.28 + rand() * 0.18;
    const minor = 0.55 + rand() * 0.25;
    const flip = rand() > 0.5 ? 1 : -1;
    const d1 = rotateAround(dir, axis, major * flip);
    const d2 = rotateAround(dir, axis, -minor * flip);
    // Slight gravity bias keeps the tree filling the broad base.
    d1.y -= 0.08; d2.y -= 0.08;
    d1.normalize(); d2.normalize();
    grow(end, d1, len * (0.8 + rand() * 0.08), r * 0.72, depth + 1, idx, side, nextRoll);
    grow(end, d2, len * (0.68 + rand() * 0.1), r * 0.62, depth + 1, idx, side, nextRoll);
  };

  for (const side of [-1, 1] as const) {
    // Right main bronchus is shorter and steeper than the left.
    const hilum = new Vector3(side * (side < 0 ? 0.72 : 0.86), side < 0 ? 0.68 : 0.78, -0.08);
    const main = add(carina, hilum, 0.08, 1, trachea);
    const lobes: [number, number, number][] = side < 0
      ? [[-0.55, 0.85, 0.05], [-0.75, -0.25, 0.55], [-0.35, -1, -0.15]] // upper, middle, lower
      : [[0.5, 0.88, 0.05], [0.45, -1, -0.1]]; // upper, lower
    for (const [x, y, z] of lobes) {
      const dir = new Vector3(x, y, z).normalize();
      const roll = new Vector3(0, 0, 1);
      grow(hilum, dir, 0.62, 0.055, 2, main, side, roll);
    }
  }
  return { segments, leaves };
}

/** One merged tube mesh for the whole tree, with an `aDepth` attribute for shading. */
export function airwayGeometry(tree: AirwayTree): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const s of tree.segments) {
    const curve = new QuadraticBezierCurve3(s.a, s.c, s.b);
    const radial = s.depth < 3 ? 10 : s.depth < 5 ? 6 : 4;
    const g = new TubeGeometry(curve, s.depth < 2 ? 12 : 4, Math.max(0.006, s.r), radial, false);
    const n = g.attributes.position.count;
    const depth = new Float32Array(n).fill(s.depth);
    g.setAttribute("aDepth", new Float32BufferAttribute(depth, 1));
    g.deleteAttribute("uv");
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Root-to-leaf polylines, used by the airflow particles. */
export interface FlowPath { points: Float32Array; cum: Float32Array; length: number; }

export function flowPaths(tree: AirwayTree): FlowPath[] {
  const out: FlowPath[] = [];
  for (const leaf of tree.leaves) {
    const chain: Segment[] = [];
    let i = leaf;
    while (i >= 0) { chain.push(tree.segments[i]); i = tree.segments[i].parent; }
    chain.reverse();
    const pts: Vector3[] = [chain[0].a];
    for (const s of chain) {
      const curve = new QuadraticBezierCurve3(s.a, s.c, s.b);
      pts.push(curve.getPoint(0.5), s.b);
    }
    const points = new Float32Array(pts.length * 3);
    const cum = new Float32Array(pts.length);
    let total = 0;
    pts.forEach((p, k) => {
      points.set([p.x, p.y, p.z], k * 3);
      if (k > 0) total += p.distanceTo(pts[k - 1]);
      cum[k] = total;
    });
    out.push({ points, cum, length: total });
  }
  return out;
}

/** Writes the point at distance fraction u along the path into out[o..o+2]. No allocation. */
export function samplePath(path: FlowPath, u: number, out: Float32Array, o: number) {
  const target = Math.max(0, Math.min(1, u)) * path.length;
  const { cum, points } = path;
  let k = 1;
  while (k < cum.length - 1 && cum[k] < target) k++;
  const span = cum[k] - cum[k - 1] || 1;
  const t = (target - cum[k - 1]) / span;
  const a = (k - 1) * 3;
  const b = k * 3;
  out[o] = points[a] + (points[b] - points[a]) * t;
  out[o + 1] = points[a + 1] + (points[b + 1] - points[a + 1]) * t;
  out[o + 2] = points[a + 2] + (points[b + 2] - points[a + 2]) * t;
}

export const TUMOR_POSITION = new Vector3(-1.34, 0.92, 0.24);
