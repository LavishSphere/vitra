/**
 * Per-launch API token. Order: URL fragment (#t=... from the launcher), then sessionStorage,
 * then VITE_VITRA_TOKEN (dev). A fragment token is kept for this tab only and removed from
 * the address bar right away.
 */
const KEY = "vitra.token";

function read(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.hash.slice(1));
  const fromHash = params.get("t") ?? params.get("vitra_token");
  if (fromHash) {
    try { window.sessionStorage.setItem(KEY, fromHash); } catch { /* storage blocked: memory only */ }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return fromHash;
  }
  try {
    const stored = window.sessionStorage.getItem(KEY);
    if (stored) return stored;
  } catch { /* storage blocked */ }
  return (import.meta.env.VITE_VITRA_TOKEN as string | undefined) ?? "";
}

export const TOKEN = read();
