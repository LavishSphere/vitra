/**
 * Shown on the public synthetic build so judges know what is real vs planned.
 * Hidden when talking to the local API (laptop demo with the 3B model).
 */
import { useVitra } from "../store/useVitra.ts";

export function DemoBanner() {
  const sourceKind = useVitra((s) => s.sourceKind);
  if (sourceKind !== "fixtures") return null;

  return (
    <aside
      className="pointer-events-auto relative z-40 border-b border-border bg-bg-elevated/95 px-4 py-2 text-[12.5px] leading-snug text-text-2 backdrop-blur-md"
      aria-label="About this demo build"
    >
      <p>
        <span className="font-medium text-text">Fake data on purpose.</span> This page is invented evidence so you can
        poke the UI. Anyone can clone the repo, drop in a Llama 3.2 3B GGUF, and run the real stack on their own
        machine with no Wi-Fi. README has the steps.
      </p>
      <p className="mt-1 text-text-muted">
        No model in the browser yet. A ~0.5B on-device build is still later work.
      </p>
    </aside>
  );
}
