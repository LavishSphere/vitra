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
        <span className="font-medium text-text">Fake data on purpose.</span> This phone page uses invented evidence so
        you can click around. The laptop demo next to it runs{" "}
        <span className="text-text">Llama 3.2 3B</span> with the Wi-Fi off.
      </p>
      <p className="mt-1 text-text-muted">
        We didn't put a model in the browser this weekend. A tiny on-device model (~0.5B) is on the list for later.
      </p>
    </aside>
  );
}
