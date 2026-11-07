import { describe, expect, it } from "vitest";
import { LineCurve3, Vector3 } from "three";
import { arcLengthTo, buildRibbon } from "./pathGeometry.ts";
import { JOURNEY_CURVE, STATION_FRAMES } from "../layout.ts";

describe("journey ribbon", () => {
  it("builds a flat strip with distance along the path in uv.x", () => {
    const line = new LineCurve3(new Vector3(0, -3, 0), new Vector3(0, -3, 10));
    const { geometry, length } = buildRibbon(line, 0.4, 20);
    expect(length).toBeCloseTo(10, 5);
    const pos = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    expect(pos.count).toBe(42);
    expect(geometry.getIndex()!.count).toBe(20 * 6);
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(-3, 6);
    expect(Math.abs(pos.getX(0) - pos.getX(1))).toBeCloseTo(0.4, 5);
    expect(uv.getX(pos.count - 1)).toBeCloseTo(10, 5);
  });

  it("reaches the stations in treatment order along the path", () => {
    const reach = STATION_FRAMES.map((f) => arcLengthTo(JOURNEY_CURVE, f.base));
    for (let i = 1; i < reach.length; i++) expect(reach[i]).toBeGreaterThan(reach[i - 1]);
  });
});
