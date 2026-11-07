import { describe, expect, it } from "vitest";
import type { EvidenceItem } from "@contract/types.ts";
import evidenceJson from "../fixtures/evidence.json";
import { useVitra } from "./useVitra.ts";

describe("scene marks", () => {
  it("never include a quote whose span fails verification", () => {
    const good = structuredClone((evidenceJson as EvidenceItem[])[0]);
    const bad = structuredClone(good);
    bad.item_id = "SYN-BAD1";
    bad.aspects = bad.aspects.map((a) => ({ ...a, span_start: a.span_start + 3, span_end: a.span_end + 3 }));
    useVitra.setState({ evidence: [good, bad], marks: [], excluded: [] });
    useVitra.getState().resetFilters();
    const ids = useVitra.getState().marks.map((m) => m.item.item_id);
    expect(ids.filter((id) => id === good.item_id).length).toBe(good.aspects.length);
    expect(ids).not.toContain("SYN-BAD1");
  });
});
