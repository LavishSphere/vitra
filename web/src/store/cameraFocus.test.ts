import { afterEach, describe, expect, it } from "vitest";
import { useVitra } from "./useVitra.ts";

afterEach(() => {
  useVitra.setState({ focusStation: null, cameraFocus: null, focusTumor: false, railTab: "trends" });
});

describe("cameraFocus", () => {
  it("an intake move sets the camera target and leaves the rail tab alone", () => {
    useVitra.getState().focusCameraOn("living", "intake");
    const s = useVitra.getState();
    expect(s.cameraFocus).toEqual({ stationId: "living", reason: "intake" });
    expect(s.focusStation).toBe("living");
    expect(s.railTab).toBe("trends");
  });

  it("a user station click keeps cameraFocus in step", () => {
    useVitra.getState().setFocusStation("access");
    expect(useVitra.getState().cameraFocus).toEqual({ stationId: "access", reason: "user" });
    useVitra.getState().setFocusStation(null);
    expect(useVitra.getState().cameraFocus).toBeNull();
  });

  it("clearFocus goes back to the overview", () => {
    useVitra.getState().focusCameraOn("clinical");
    useVitra.getState().clearFocus();
    const s = useVitra.getState();
    expect(s.cameraFocus).toBeNull();
    expect(s.focusStation).toBeNull();
  });
});
