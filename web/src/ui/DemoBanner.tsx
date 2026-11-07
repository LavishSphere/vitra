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
        <span className="font-medium text-text">Synthetic demo.</span> Evidence on this page is invented so you can
        poke the product on a phone. At the table, the live path runs{" "}
        <span className="text-text">Llama 3.2 3B</span> on the laptop with Wi-Fi off.
      </p>
      <p className="mt-1 text-text-muted">
        Next step we did not ship this weekend: a smaller on-device model (about 0.5B) in the phone browser. With
        better quantization, future on-device models may get closer to the desktop 3B quality Vitra uses today. That
        is ambition, not this build.
      </p>
    </aside>
  );
}
