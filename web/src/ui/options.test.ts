import { describe, expect, it } from "vitest";
import { aspectOptions, signalOptions, sourceOptions, speakerOptions } from "./options.ts";

describe("filter menu order", () => {
  it("lists aspect labels in the order ArrowDown walks", () => {
    expect(aspectOptions().map((o) => o.label)).toEqual([
      "All aspects",
      "Efficacy",
      "Safety",
      "Convenience",
      "Access and cost",
      "Evidence quality",
    ]);
  });

  it("keeps All as the first row in every filter", () => {
    for (const options of [speakerOptions(), aspectOptions(), sourceOptions(), signalOptions()]) {
      expect(options[0]?.value).toBe("all");
      expect(options[0]?.label.startsWith("All")).toBe(true);
    }
  });
});
