/**
 * Shown on the public synthetic build so visitors know the evidence is invented and the model runs locally.
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
        <span className="font-medium text-text">This page uses made-up evidence.</span> It's a public preview of the
        interface, so the quotes, trends and cards here are invented for the demo.
      </p>
      <p className="mt-1 text-text-muted">
        The labeling model doesn't run on this page. The real version runs a 3B model on a laptop with the Wi-Fi off.{" "}
        <a
          className="text-accent underline-offset-2 hover:text-accent-hover hover:underline"
          href="https://github.com/LavishSphere/vitra#setup"
          target="_blank"
          rel="noreferrer"
        >
          See how to run it
        </a>
      </p>
    </aside>
  );
}
