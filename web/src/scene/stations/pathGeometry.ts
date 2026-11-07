import { BufferAttribute, BufferGeometry, type Curve, Vector3 } from "three";

/**
 * A flat ribbon lying on the floor along `curve`. uv.x = distance along the path in world
 * units, uv.y = -1..1 across it. Returns the geometry and the path length.
 */
export function buildRibbon(curve: Curve<Vector3>, width: number, segments: number): { geometry: BufferGeometry; length: number } {
  const n = segments + 1;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = new Uint32Array(segments * 6);
  const p = new Vector3();
  const t = new Vector3();
  const prev = new Vector3();
  let length = 0;
  for (let i = 0; i < n; i++) {
    const u = i / segments;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, t);
    if (i > 0) length += p.distanceTo(prev);
    prev.copy(p);
    // Side vector in the floor plane.
    const sx = -t.z;
    const sz = t.x;
    const sl = Math.hypot(sx, sz) || 1;
    const hx = (sx / sl) * (width / 2);
    const hz = (sz / sl) * (width / 2);
    pos.set([p.x + hx, p.y, p.z + hz, p.x - hx, p.y, p.z - hz], i * 6);
    uv.set([length, -1, length, 1], i * 4);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    idx.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], i * 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  geometry.setIndex(new BufferAttribute(idx, 1));
  geometry.computeBoundingSphere();
  return { geometry, length };
}

/** Distance along `curve` (world units) to the point on it closest to `target`. */
export function arcLengthTo(curve: Curve<Vector3>, target: Vector3, samples = 1000): number {
  const lengths = curve.getLengths(samples);
  const p = new Vector3();
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= samples; i++) {
    curve.getPoint(i / samples, p);
    const d = p.distanceToSquared(target);
    if (d < bestD) { bestD = d; best = i; }
  }
  return lengths[best];
}
