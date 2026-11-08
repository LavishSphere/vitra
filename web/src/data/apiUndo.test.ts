import { afterEach, describe, expect, it, vi } from "vitest";
import { apiSource } from "./apiSource.ts";

type Call = { url: string; method: string };

function stubFetch(statusFor: (c: Call) => number): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const c = { url, method: init?.method ?? "GET" };
    calls.push(c);
    const status = statusFor(c);
    return new Response(JSON.stringify(status < 400 ? { ok: true } : { detail: "Not Found" }), { status });
  });
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("apiSource.undo", () => {
  it("deletes just the one transcript when the API supports it", async () => {
    const calls = stubFetch(() => 200);
    expect(await apiSource.undo("PT-0003")).toBe("one");
    expect(calls.map((c) => `${c.method} ${c.url.replace(/^https?:\/\/[^/]+/, "")}`)).toEqual(["DELETE /api/intake/PT-0003"]);
  });

  it("falls back to reset when the API has no per-transcript delete", async () => {
    const calls = stubFetch((c) => (c.method === "DELETE" ? 404 : 200));
    expect(await apiSource.undo("PT-0003")).toBe("all");
    expect(calls.map((c) => `${c.method} ${c.url.replace(/^https?:\/\/[^/]+/, "")}`)).toEqual(["DELETE /api/intake/PT-0003", "POST /api/reset"]);
  });

  it("surfaces other failures instead of resetting", async () => {
    stubFetch(() => 500);
    await expect(apiSource.undo("PT-0003")).rejects.toThrow(/500/);
  });
});
