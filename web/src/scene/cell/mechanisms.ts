/**
 * What the cell view may show for each product. Captions are copied from verified rows in the
 * team's biomedical sources file (label wording, DailyMed). Nothing here comes from memory.
 *
 * Only amivantamab has a verified binding location (the extracellular domains of EGFR and MET),
 * so it is the only drug drawn at the receptors. Osimertinib and lazertinib are label-only
 * callouts: their labels say "kinase inhibitor of EGFR" but do not name a binding site.
 */
import { BIO_FACTS, MECHANISM_CAPTION, type BioFact } from "../../data/biomedical.ts";

export { MECHANISM_CAPTION };

export interface Caption { id: string; text: string; source: string; checked: string; }

function fact(id: string): Caption {
  const f = BIO_FACTS.find((x: BioFact) => x.id === id);
  if (!f || !f.checked) throw new Error(`caption ${id} is not a checked fact`);
  return { id: f.id, text: f.text, source: f.source, checked: f.checked };
}

/** Verified row (c), Lazcluze PI section 1. Not yet in BIO_FACTS, so it lives here. */
const LAZ_COMBO: Caption = {
  id: "laz-combo",
  text: "Lazcluze is indicated in combination with amivantamab for first-line treatment of advanced EGFR exon 19 deletion or L858R NSCLC.",
  source: "Lazcluze PI 1, rev. 04/2026",
  checked: "2026-11-07",
};

export type CellProduct = "rybrevant" | "tagrisso" | "lazcluze";

export interface Mechanism {
  id: CellProduct;
  brand: string;
  drug: string;
  captions: Caption[];
  /** Draw amivantamab bound at the EGFR and MET extracellular domains. Verified for amivantamab only. */
  antibody: "bound" | "none";
  /** A label-only callout next to the EGFR tag. Never placed at a site on the receptor. */
  callout: { drug: string; role: string; note: string } | null;
}

const NO_SITE = "Binding site not shown. The label does not name it.";

export const MECHANISMS: Record<CellProduct, Mechanism> = {
  rybrevant: {
    id: "rybrevant", brand: "Rybrevant", drug: "amivantamab",
    captions: [fact("ami-moa")],
    antibody: "bound",
    callout: null,
  },
  tagrisso: {
    id: "tagrisso", brand: "Tagrisso", drug: "osimertinib",
    captions: [fact("osi-moa")],
    antibody: "none",
    // "kinase inhibitor of EGFR" is the Tagrisso PI 12.1 wording.
    callout: { drug: "Osimertinib", role: "Kinase inhibitor of EGFR.", note: NO_SITE },
  },
  lazcluze: {
    id: "lazcluze", brand: "Lazcluze", drug: "lazertinib",
    captions: [fact("laz-moa"), LAZ_COMBO],
    antibody: "bound",
    // "EGFR kinase inhibitor" is the Lazcluze PI 12.1 wording.
    callout: { drug: "Lazertinib", role: "EGFR kinase inhibitor.", note: NO_SITE },
  },
};

export const CELL_PRODUCTS: CellProduct[] = ["rybrevant", "tagrisso", "lazcluze"];

export function defaultCellProduct(filter: "A" | "B" | "all"): CellProduct {
  return filter === "A" ? "tagrisso" : "rybrevant";
}

/** Short on-scene labels. Names only, taken from the captions above. */
export const SCENE_LABELS = {
  egfr: "EGFR",
  met: "MET",
  side: "Extracellular",
  antibody: "amivantamab",
} as const;
