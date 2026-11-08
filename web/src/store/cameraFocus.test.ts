import { afterEach, describe, expect, it } from "vitest";
import { useVitra } from "./useVitra.ts";

afterEach(() => {
  useVitra.setState({ focusStation: null, cameraFocus: null, focusTumor: false, tumorCardOpen: false, railTab: "trends" });
});

describe("cameraFocus", () => {
  it("an intake move sets the camera target and leaves the rail tab alone", () => {
    useVitra.getState().focusCameraOn("living", "intake");
    const s = useVitra.getState();
    expect(s.cameraFocus).toEqual({ kind: "station", stationId: "living", reason: "intake" });
    expect(s.focusStation).toBe("living");
    expect(s.railTab).toBe("trends");
  });

  it("a user station click keeps cameraFocus in step", () => {
    useVitra.getState().setFocusStation("access");
    expect(useVitra.getState().cameraFocus).toEqual({ kind: "station", stationId: "access", reason: "user" });
    useVitra.getState().setFocusStation(null);
    expect(useVitra.getState().cameraFocus).toBeNull();
  });

  it("diveTo sets an evidence focus on the mark's station", async () => {
    await useVitra.getState().load();
    const m = useVitra.getState().marks.find((x) => x.visible);
    expect(m).toBeTruthy();
    useVitra.getState().diveTo(m!.item.item_id, m!.aspect.aspect);
    const s = useVitra.getState();
    expect(s.cameraFocus).toEqual({
      kind: "evidence",
      stationId: m!.station,
      itemId: m!.item.item_id,
      aspect: m!.aspect.aspect,
      reason: "user",
    });
    expect(s.focusStation).toBe(m!.station);
  });

  it("clearFocus goes back to the overview", () => {
    useVitra.getState().focusCameraOn("clinical");
    useVitra.getState().clearFocus();
    const s = useVitra.getState();
    expect(s.cameraFocus).toBeNull();
    expect(s.focusStation).toBeNull();
  });
});
