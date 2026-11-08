import { afterEach, describe, expect, it } from "vitest";
import type { Mark } from "../store/useVitra.ts";
import { useVitra } from "../store/useVitra.ts";
import { useArrival } from "../scene/arrival.ts";
import { useCellDive } from "../scene/cell/store.ts";
import {
  GUIDED_ENTRY,
  GUIDED_FOOTER,
  GUIDED_STEPS,
  GUIDED_TIME,
  GUIDED_TITLE,
  exploreLung,
  firstSafetyMark,
  registerSampleIntake,
  runSampleIntake,
  selectSafetyEvidence,
} from "./guided.ts";

afterEach(() => {
  if (useVitra.getState().weeks.length) useVitra.getState().resetFilters();
  useVitra.setState({
    selection: null,
    focusStation: null,
    cameraFocus: null,
    focusTumor: false,
    tumorCardOpen: false,
    railOpen: false,
    intakeOpen: false,
  });
  useCellDive.getState().closeDive();
  useArrival.setState({ arriving: true, engaged: false });
});

function safetyMark(id: string, visible: boolean, excluded: boolean): Mark {
  return {
    index: 0,
    key: `${id}:safety`,
    item: { item_id: id } as Mark["item"],
    aspect: { aspect: "safety" } as Mark["aspect"],
    station: "living",
    visible,
    excluded,
  };
}

describe("guided experience", () => {
  it("keeps the card copy in sentence case without dashes", () => {
    const copy = [GUIDED_ENTRY, GUIDED_TITLE, GUIDED_TIME, GUIDED_FOOTER, ...GUIDED_STEPS.flatMap((s) => [s.title, s.body])].join("\n");
    expect(copy).not.toMatch(/[\u2013\u2014]|VITRA/);
    expect(copy).toContain("Vitra");
    expect(GUIDED_STEPS.map((s) => s.title)).toEqual([
      "Explore the lung",
      "Investigate real-world evidence",
      "Watch the intelligence change",
    ]);
  });

  it("picks the first visible safety mark that is not excluded", () => {
    const marks = [
      safetyMark("hidden", false, false),
      safetyMark("excluded", true, true),
      safetyMark("first", true, false),
      safetyMark("later", true, false),
    ];
    expect(firstSafetyMark(marks)?.item.item_id).toBe("first");
  });

  it("selects the first visible safety mark, the same as a click", async () => {
    await useVitra.getState().load();
    const expected = firstSafetyMark(useVitra.getState().marks);
    expect(expected).toBeTruthy();
    expect(selectSafetyEvidence()).toBe(true);
    expect(useVitra.getState().selection).toEqual({
      itemId: expected!.item.item_id,
      aspect: "safety",
    });
    expect(useVitra.getState().filters.aspect).toBe("all");
  });

  it("filters to safety when that aspect is hidden, then selects a visible mark", async () => {
    await useVitra.getState().load();
    useVitra.getState().setFilter("aspect", "efficacy");
    expect(firstSafetyMark(useVitra.getState().marks)).toBeUndefined();
    expect(selectSafetyEvidence()).toBe(true);
    const sel = useVitra.getState().selection;
    expect(sel?.aspect).toBe("safety");
    const mark = useVitra.getState().marks.find((m) => m.item.item_id === sel?.itemId && m.aspect.aspect === "safety");
    expect(mark?.visible).toBe(true);
    expect(mark?.excluded).toBe(false);
    expect(useVitra.getState().filters.aspect).toBe("safety");
  });

  it("flies to the tumor and opens the facts card", () => {
    exploreLung(null);
    expect(useVitra.getState().focusTumor).toBe(true);
    expect(useVitra.getState().tumorCardOpen).toBe(true);
    expect(useCellDive.getState().open).toBe(false);
    expect(useArrival.getState().engaged).toBe(true);
  });

  it("opens the receptor dive when the tumor is already focused", () => {
    useVitra.getState().setFocusTumor(true);
    useCellDive.getState().closeDive();
    exploreLung(null);
    expect(useCellDive.getState().open).toBe(true);
    expect(useVitra.getState().focusTumor).toBe(true);
  });

  it("runs the intake sample handler the card registered", () => {
    let n = 0;
    const off = registerSampleIntake(() => { n += 1; });
    runSampleIntake();
    expect(n).toBe(1);
    off();
    runSampleIntake();
    expect(n).toBe(1);
  });
});
