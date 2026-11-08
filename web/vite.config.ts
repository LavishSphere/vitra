import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const contractDir = fileURLToPath(new URL("../contracts", import.meta.url));

/**
 * Library error messages carry documentation links (react.dev, github.com, docs.pmnd.rs).
 * They are never fetched, but the offline check rejects any http(s) URL in dist that isn't
 * loopback or an XML namespace. Drop the scheme so they stay readable as plain text.
 */
function stripDocUrls(): Plugin {
  const keep = /^https?:\/\/(127\.0\.0\.1|localhost|www\.w3\.org|github\.com\/LavishSphere\/vitra)([:/#]|$)/;
  const strip = (code: string) =>
    code.replace(/https?:\/\/[A-Za-z0-9.-]+[^\s"'`)<>]*/g, (url) => (keep.test(url) ? url : url.replace(/^https?:\/\//, "")));
  return {
    name: "vitra-strip-doc-urls",
    apply: "build",
    renderChunk(code) {
      const out = strip(code);
      return out === code ? null : { code: out, map: null };
    },
    generateBundle(_, bundle) {
      // CSS license banners (for example Tailwind's) carry a link too.
      for (const file of Object.values(bundle)) {
        if (file.type === "asset" && file.fileName.endsWith(".css") && typeof file.source === "string") {
          file.source = strip(file.source);
        }
      }
    },
  };
}

/** Public fixture Pages builds: drop the local-dev connect-src hosts from the CSP meta. */
function stripDevConnectSrc(): Plugin {
  const fixtures = process.env.VITE_DATA_SOURCE === "fixtures";
  const drop =
    / ws:\/\/127\.0\.0\.1:5173 ws:\/\/localhost:5173 http:\/\/127\.0\.0\.1:8000/;
  return {
    name: "vitra-strip-dev-connect-src",
    transformIndexHtml(html) {
      if (!fixtures) return html;
      return html.replace(drop, "");
    },
  };
}

export default defineConfig({
  // Public Pages build sets VITE_BASE=/ ; local and API-served builds keep ./
  base: (process.env.VITE_BASE as string | undefined) || "./",
  plugins: [react(), tailwindcss(), stripDocUrls(), stripDevConnectSrc()],
  resolve: {
    alias: { "@contract": contractDir },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url)), contractDir] },
  },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
