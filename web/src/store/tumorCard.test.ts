import { afterEach, describe, expect, it } from "vitest";
import { useVitra } from "./useVitra.ts";

afterEach(() => {
  useVitra.setState({
    focusStation: null,
    cameraFocus: null,
    focusTumor: false,
    tumorCardOpen: false,
    railTab: "trends",
  });
});

describe("tumorCardOpen", () => {
  it("entering the tumor opens the card; Close hides it and keeps the zoom", () => {
    useVitra.getState().setFocusTumor(true);
    expect(useVitra.getState().focusTumor).toBe(true);
    expect(useVitra.getState().tumorCardOpen).toBe(true);

    useVitra.getState().setTumorCardOpen(false);
    expect(useVitra.getState().focusTumor).toBe(true);
    expect(useVitra.getState().tumorCardOpen).toBe(false);

    useVitra.getState().setTumorCardOpen(true);
    expect(useVitra.getState().tumorCardOpen).toBe(true);
  });

  it("clearFocus exits the zoom and the card together", () => {
    useVitra.getState().setFocusTumor(true);
    useVitra.getState().setTumorCardOpen(false);
    useVitra.getState().clearFocus();
    const s = useVitra.getState();
    expect(s.focusTumor).toBe(false);
    expect(s.tumorCardOpen).toBe(false);
  });

  it("does not open the card when the camera is not on the tumor", () => {
    useVitra.getState().setTumorCardOpen(true);
    expect(useVitra.getState().tumorCardOpen).toBe(false);
  });
});
