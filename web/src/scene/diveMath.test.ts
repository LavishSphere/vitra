import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import type { EvidenceItem } from "@contract/types.ts";
import type { Mark } from "../store/useVitra.ts";
import { stationFor } from "../data/stations.ts";
import { CARD_GAP, GLIDE_SECONDS, cardAnchor, diveKey, diveOrder, divePose, easeInOutCubic, stepDive, trailControl } from "./diveMath.ts";

function mark(index: number, id: string, week: string, aspect: string, polarity: number, speaker = "researcher", visible = true): Mark {
  const item = { item_id: id, iso_week: week } as EvidenceItem;
  const a = { aspect, polarity, speaker, span: "x", span_start: 0, span_end: 1 } as Mark["aspect"];
  return { index, key: `${id}:${aspect}`, item, aspect: a, station: stationFor(a.aspect, a.speaker), visible, excluded: false };
}

const marks = [
  mark(0, "A", "2025-W03", "access_cost", 1),
  mark(1, "B", "2025-W02", "efficacy", 2),
  mark(2, "C", "2025-W02", "efficacy", -1),
  mark(3, "D", "2025-W01", "safety", 0),
  mark(4, "E", "2025-W01", "efficacy", 0, "researcher", false),
];

describe("dive walk", () => {
  it("walks visible marks in journey order, then week, then polarity", () => {
    expect(diveOrder(marks).map((m) => m.key)).toEqual(["C:efficacy", "B:efficacy", "D:safety", "A:access_cost"]);
  });

  it("steps forward and back with wrap-around", () => {
    const order = diveOrder(marks);
    expect(stepDive(order, "C:efficacy", 1)!.key).toBe("B:efficacy");
    expect(stepDive(order, "A:access_cost", 1)!.key).toBe("C:efficacy");
    expect(stepDive(order, "C:efficacy", -1)!.key).toBe("A:access_cost");
    expect(stepDive(order, "gone:safety", 1)!.key).toBe("C:efficacy");
    expect(stepDive(order, null, -1)!.key).toBe("A:access_cost");
    expect(stepDive([], "x", 1)).toBeNull();
  });

  it("keys targets the same way the store keys marks", () => {
    expect(diveKey({ itemId: "B", aspect: "efficacy" })).toBe(marks[1].key);
  });
});

describe("dive geometry", () => {
  it("glides in under a second with an ease that starts and ends at rest", () => {
    expect(GLIDE_SECONDS).toBeLessThan(1);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9);
  });

  it("puts the camera in front of the panel, looking back at the point", () => {
    const q = new Quaternion();
    const pos = new Vector3();
    const target = new Vector3();
    divePose(new Vector3(0.4, -2.4, 3.7), q, new Vector3(0, -2.55, 3.6), pos, target);
    expect(pos.z - target.z).toBeCloseTo(6.2, 6);
    expect(pos.y).toBeGreaterThan(target.y);
    expect(target.x).toBeGreaterThan(0.4); // aimed right of the station, room for the card
  });

  it("pins the card at the panel's right edge, level with the point", () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3);
    const center = new Vector3(1, -2.55, 3.6);
    const right = new Vector3(1, 0, 0).applyQuaternion(q);
    const mark = center.clone().addScaledVector(right, -0.4).setY(-2.1);
    const a = cardAnchor(mark, q, center, 1.025, new Vector3());
    expect(a.y).toBeCloseTo(-2.1, 9);
    expect(right.dot(a.clone().sub(center))).toBeCloseTo(1.025 + CARD_GAP, 9);
  });

  it("lifts the trail off the glass toward the viewer", () => {
    const c = trailControl(new Vector3(0, -2.4, 3.7), new Vector3(-1, -1.6, 3.6), new Quaternion(), new Vector3());
    expect(c.z).toBeGreaterThan(3.7);
    expect(c.y).toBeGreaterThan(-1.6);
  });
});
