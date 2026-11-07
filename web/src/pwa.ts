/** Register the local service worker in production builds only. */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(ready: boolean) => void>();

export function onInstallReady(fn: (ready: boolean) => void): () => void {
  listeners.add(fn);
  fn(deferred !== null);
  return () => {
    listeners.delete(fn);
  };
}

function notify(ready: boolean): void {
  for (const fn of listeners) fn(ready);
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  const ev = deferred;
  deferred = null;
  notify(false);
  await ev.prompt();
  return (await ev.userChoice).outcome;
}

export function registerPwa(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify(true);
  });

  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify(false);
  });

  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
    /* install is optional; a failed register must not break the UI */
  });
}
