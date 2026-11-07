import { afterEach, describe, expect, it, vi } from "vitest";

describe("pwa helpers", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("promptInstall returns unavailable when no deferred event", async () => {
    const { promptInstall } = await import("./pwa.ts");
    await expect(promptInstall()).resolves.toBe("unavailable");
  });

  it("registerPwa no-ops outside production", async () => {
    const register = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    const { registerPwa } = await import("./pwa.ts");
    registerPwa();
    expect(register).not.toHaveBeenCalled();
  });
});
