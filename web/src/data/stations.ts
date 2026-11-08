/**
 * Treatment-journey stations. Each (item, aspect) lands at exactly one station, by a fixed
 * documented rule on aspect and speaker. The stations are an organizing metaphor for launch
 * evidence categories, not a claim about any patient's experience.
 */
import type { AspectKey, Speaker } from "@contract/types.ts";

export type StationId = "clinical" | "decision" | "administration" | "living" | "access";

export interface StationDef {
  id: StationId;
  label: string;
  short: string;
  rule: string;
}

export const STATIONS: StationDef[] = [
  { id: "clinical", label: "Clinical evidence", short: "Clinical", rule: "Efficacy and evidence quality, except clinician and patient voices" },
  { id: "decision", label: "Clinician decision", short: "Clinician", rule: "Clinicians (hcp) on efficacy and evidence quality" },
  { id: "administration", label: "Administration", short: "Administration", rule: "Convenience, from any voice" },
  { id: "living", label: "Living with treatment", short: "Living with it", rule: "Safety from any voice, and patient voice on efficacy" },
  { id: "access", label: "Access", short: "Access", rule: "Access and cost, from any voice" },
];

/** Aspect decides first, so a quote always lands where its topic lives. */
export function stationFor(aspect: AspectKey, speaker: Speaker): StationId {
  if (aspect === "access_cost") return "access";
  if (aspect === "convenience") return "administration";
  if (aspect === "safety") return "living";
  if (speaker === "hcp") return "decision";
  if (speaker === "patient") return "living";
  return "clinical";
}

export const STATION_INDEX: Record<StationId, number> = {
  clinical: 0, decision: 1, administration: 2, living: 3, access: 4,
};
