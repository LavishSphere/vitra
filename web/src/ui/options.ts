import { ASPECTS, SPEAKERS, type AspectKey, type SignalType, type Source, type Speaker } from "@contract/types.ts";
import type { Option } from "./controls.tsx";
import type { ProductFilter } from "../store/useVitra.ts";
import { humanize } from "../lib/format.ts";

export const PRODUCT_LABEL: Record<"A" | "B" | "both", string> = {
  A: "Tagrisso",
  B: "Rybrevant + Lazcluze",
  both: "Both products",
};

export const PRODUCT_OPTIONS: Option<ProductFilter>[] = [
  { value: "A", label: "Tagrisso", hint: "Product A" },
  { value: "B", label: "Rybrevant + Lazcluze", hint: "Product B, includes Rybrevant Faspro" },
  { value: "all", label: "Both", hint: "Everything, including items that mention both" },
];

export const ASPECT_LABEL: Record<AspectKey, string> = {
  efficacy: "Efficacy",
  safety: "Safety",
  convenience: "Convenience",
  access_cost: "Access and cost",
  evidence_quality: "Evidence quality",
};

export const SOURCE_LABEL: Record<Source, string> = {
  pubmed: "PubMed",
  ctgov: "ClinicalTrials.gov",
  fda_event: "FDA adverse events",
  fda_label: "FDA label",
  fda_notice: "FDA notice",
  press_release: "Press release",
  news: "News",
  transcript: "Transcript",
};

export const SIGNALS: SignalType[] = ["efficacy", "safety", "regulatory", "trial_update", "competitor_move", "access_pricing", "guideline", "expert_opinion", "none"];
export const SOURCES: Source[] = ["pubmed", "ctgov", "fda_event", "fda_label", "fda_notice", "press_release", "news", "transcript"];

export const SPEAKER_LABEL: Record<Speaker, string> = {
  researcher: "Researcher", hcp: "Clinician (hcp)", patient: "Patient", company: "Company",
  regulator: "Regulator", payer: "Payer", media: "Media",
};

export const speakerOptions = (): Option<Speaker | "all">[] => [
  { value: "all", label: "All voices" },
  ...SPEAKERS.map((s) => ({ value: s, label: SPEAKER_LABEL[s] })),
];
export const aspectOptions = (): Option<AspectKey | "all">[] => [
  { value: "all", label: "All aspects" },
  ...ASPECTS.map((a) => ({ value: a, label: ASPECT_LABEL[a] })),
];
export const sourceOptions = (): Option<Source | "all">[] => [
  { value: "all", label: "All sources" },
  ...SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] })),
];
export const signalOptions = (): Option<SignalType | "all">[] => [
  { value: "all", label: "All signals" },
  ...SIGNALS.map((s) => ({ value: s, label: s === "none" ? "No signal" : humanize(s).replace(/^\w/, (c) => c.toUpperCase()) })),
];
