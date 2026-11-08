/**
 * On-screen biomedical facts. Each line was checked against the DailyMed label named
 * in `source`. Add nothing from memory. A fact with `checked: null` never renders.
 */
export interface BioFact { id: string; product: "A" | "B" | "both"; text: string; source: string; checked: string | null; }

export const BIO_FACTS: BioFact[] = [
  { id: "osi-moa", product: "A", checked: "2026-11-07",
    text: "Osimertinib is a kinase inhibitor of EGFR that binds irreversibly to certain mutant forms (T790M, L858R, exon 19 deletions) at lower concentrations than wild-type.",
    source: "Tagrisso PI 12.1, rev. 09/2026" },
  { id: "ami-moa", product: "B", checked: "2026-11-07",
    text: "Amivantamab is a bispecific antibody that binds the extracellular domains of EGFR and MET.",
    source: "Rybrevant PI 12.1, rev. 11/2025; Rybrevant Faspro PI 12.1, rev. 02/2026" },
  { id: "laz-moa", product: "B", checked: "2026-11-07",
    text: "Lazertinib is an EGFR kinase inhibitor that inhibits exon 19 deletion and L858R mutant EGFR at lower concentrations than wild-type EGFR.",
    source: "Lazcluze PI 12.1, rev. 04/2026" },
  { id: "faspro-route", product: "B", checked: "2026-11-07",
    text: "Rybrevant Faspro (amivantamab and hyaluronidase-lpuj) is injected under the skin of the abdomen over about 5 minutes. Rybrevant is an intravenous infusion.",
    source: "Rybrevant Faspro PI 2.1; Rybrevant PI 2.10" },
  { id: "not-interchangeable", product: "both", checked: "2026-11-07",
    text: "These products have different labeled populations, regimens and routes. They are not interchangeable.",
    source: "Team summary of the indications; Faspro PI 2.1" },
];

export function verifiedFacts(product: "A" | "B" | "all"): BioFact[] {
  return BIO_FACTS.filter((f) => f.checked && (product === "all" || f.product === product || f.product === "both"));
}

export const MECHANISM_CAPTION = "Illustrative mechanism, not a clinical simulation.";
