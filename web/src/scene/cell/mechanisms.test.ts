import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CELL_PRODUCTS, MECHANISMS, MECHANISM_CAPTION, defaultCellProduct } from "./mechanisms.ts";

// The sources file is local-only. Check against it when it is present (VITRA_BIO_SOURCES or ../docs).
const candidates = [
  process.env.VITRA_BIO_SOURCES,
  fileURLToPath(new URL("../../../../docs/biomedical-sources.md", import.meta.url)),
].filter((p): p is string => !!p);
const sourcesPath = candidates.find((p) => existsSync(p));

const all = CELL_PRODUCTS.flatMap((p) => MECHANISMS[p].captions);

describe("cell view mechanisms", () => {
  it("draws a drug at the receptors only for amivantamab, the one verified binding location", () => {
    expect(MECHANISMS.tagrisso.antibody).toBe("none");
    expect(MECHANISMS.tagrisso.callout).not.toBeNull();
    expect(MECHANISMS.lazcluze.callout).not.toBeNull();
    expect(MECHANISMS.rybrevant.antibody).toBe("bound");
    expect(MECHANISMS.rybrevant.captions[0].text).toContain("extracellular domains of EGFR and MET");
  });

  it("never captions an unverified binding location", () => {
    for (const c of all) {
      expect(c.text.toLowerCase()).not.toContain("intracellular");
      expect(c.text.toLowerCase()).not.toContain("kinase domain");
      expect(c.id).not.toBe("osi-site");
      expect(c.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("uses the label wording for Tagrisso", () => {
    expect(MECHANISMS.tagrisso.captions[0].text).toContain(
      "kinase inhibitor of EGFR that binds irreversibly to certain mutant forms (T790M, L858R, exon 19 deletions)",
    );
  });

  it("keeps every caption at 25 words or fewer", () => {
    for (const c of all) expect(c.text.split(/\s+/).length).toBeLessThanOrEqual(25);
  });

  it("has the required mechanism caption", () => {
    expect(MECHANISM_CAPTION).toBe("Illustrative mechanism, not a clinical simulation.");
  });

  it("maps the product filter to a starting view", () => {
    expect(defaultCellProduct("A")).toBe("tagrisso");
    expect(defaultCellProduct("B")).toBe("rybrevant");
    expect(defaultCellProduct("all")).toBe("rybrevant");
  });

  it.skipIf(!sourcesPath)("copies every caption verbatim from a checked row in biomedical-sources.md", () => {
    const md = readFileSync(sourcesPath!, "utf8");
    for (const c of all) {
      const row = md.split("\n").find((l) => l.startsWith("|") && l.includes(c.text));
      expect(row, c.id).toBeDefined();
      expect(row!.toLowerCase()).not.toContain("unverified");
      expect(row!).toMatch(/2026-\d{2}-\d{2}, the team/);
    }
  });
});
