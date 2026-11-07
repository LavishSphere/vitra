import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { STATIONS } from "../data/stations.ts";
import {
  JOURNEY_CURVE, OVERVIEW, PANEL, STATION_FRAMES, STATION_POSES,
  markWorldPosition, stationLabelAnchor, weekX,
} from "./layout.ts";

/** Overview camera with the aspect of the scene area left of the rail at 1440x900. */
function overviewCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(34, 1020 / 795, 0.1, 120);
  cam.position.copy(OVERVIEW.position);
  cam.lookAt(OVERVIEW.target);
  cam.updateMatrixWorld();
  return cam;
}

interface Rect { x0: number; x1: number; y0: number; y1: number }
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function panelRect(i: number, cam: PerspectiveCamera): Rect {
  const r: Rect = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const v = new Vector3((sx * PANEL.width) / 2, (sy * PANEL.height) / 2, 0).applyMatrix4(STATION_FRAMES[i].matrix).project(cam);
    r.x0 = Math.min(r.x0, v.x); r.x1 = Math.max(r.x1, v.x);
    r.y0 = Math.min(r.y0, v.y); r.y1 = Math.max(r.y1, v.y);
  }
  return r;
}

describe("station layout", () => {
  it("has a camera pose for every station that looks at the panel from its front", () => {
    for (const s of STATIONS) {
      const pose = STATION_POSES[s.id];
      expect(pose).toBeDefined();
      for (const n of [...pose.position, ...pose.target]) expect(Number.isFinite(n)).toBe(true);
      const f = STATION_FRAMES.find((x) => x.id === s.id)!;
      const view = new Vector3(...pose.position).sub(new Vector3(...pose.target));
      expect(view.length()).toBeGreaterThan(4);
      expect(view.length()).toBeLessThan(9);
      expect(view.normalize().dot(f.outward)).toBeGreaterThan(0.9);
    }
  });

  it("orders the stations from the lungs toward the viewer", () => {
    for (let i = 1; i < STATION_FRAMES.length; i++) {
      expect(STATION_FRAMES[i].base.z).toBeGreaterThan(STATION_FRAMES[i - 1].base.z);
    }
  });

  it("runs the journey path through every plinth", () => {
    const pts = JOURNEY_CURVE.getSpacedPoints(4000);
    for (const f of STATION_FRAMES) {
      const d = Math.min(...pts.map((p) => p.distanceTo(f.base)));
      expect(d).toBeLessThan(0.05);
    }
  });

  it("keeps every panel on screen and apart from the others in the overview", () => {
    const cam = overviewCamera();
    const rects = STATION_FRAMES.map((_, i) => panelRect(i, cam));
    for (const r of rects) {
      expect(r.x0).toBeGreaterThan(-1);
      expect(r.x1).toBeLessThan(1);
      expect(r.y0).toBeGreaterThan(-1);
      expect(r.y1).toBeLessThan(1);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
    }
  });

  it("keeps station labels off the other panels in the overview", () => {
    const cam = overviewCamera();
    const rects = STATION_FRAMES.map((_, i) => panelRect(i, cam));
    STATIONS.forEach((s, i) => {
      const a = stationLabelAnchor(s.id).project(cam);
      // A label is about 150 px wide and 26 px tall, drawn up and to the right of its anchor.
      const label: Rect = { x0: a.x, x1: a.x + 0.3, y0: a.y, y1: a.y + 0.065 };
      rects.forEach((r, j) => { if (j !== i) expect(overlaps(label, r)).toBe(false); });
    });
  });

  it("maps week to panel x and polarity to panel height", () => {
    const n = 30;
    expect(weekX(0, n)).toBeLessThan(weekX(n - 1, n));
    const lo = markWorldPosition("access", 5, n, -2, new Vector3());
    const hi = markWorldPosition("access", 5, n, 2, new Vector3());
    expect(hi.y - lo.y).toBeCloseTo(4 * PANEL.polarityStep, 5);
  });
});
