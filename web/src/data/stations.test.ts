import { describe, expect, it } from "vitest";
import { stationFor } from "./stations.ts";

describe("stationFor", () => {
  it("routes by aspect first", () => {
    expect(stationFor("convenience", "hcp")).toBe("administration");
    expect(stationFor("safety", "hcp")).toBe("living");
    expect(stationFor("access_cost", "hcp")).toBe("access");
    expect(stationFor("efficacy", "researcher")).toBe("clinical");
    expect(stationFor("evidence_quality", "company")).toBe("clinical");
  });

  it("keeps clinician and patient voices on efficacy at their own stations", () => {
    expect(stationFor("efficacy", "hcp")).toBe("decision");
    expect(stationFor("evidence_quality", "hcp")).toBe("decision");
    expect(stationFor("efficacy", "patient")).toBe("living");
  });
});
