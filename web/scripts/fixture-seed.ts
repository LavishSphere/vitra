/**
 * SYNTHETIC demo seed. Every title, text, person, site and outlet below is invented for the
 * VITRA demo. None of it is package data, and none of it is a clinical claim.
 * `npm run fixtures` turns this into src/fixtures/*.json with verified span offsets.
 */
import type { AspectKey, Polarity, Product, SignalType, Source, Speaker } from "../../contracts/types.ts";

export type SeedAspect = [AspectKey, Polarity, Speaker, string];

export interface SeedItem {
  n: number;
  source: Source;
  product: Product;
  date: string;
  signal: SignalType;
  actionable: "yes" | "no";
  title: string;
  text: string;
  aspects: SeedAspect[];
}

export const SEED: SeedItem[] = [
  // ---------------- Product A ----------------
  {
    n: 1, source: "pubmed", product: "A", date: "2025-04-02", signal: "efficacy", actionable: "yes",
    title: "Tagrisso in a fictional multicenter EGFR cohort: synthetic interim report",
    text: "This synthetic abstract describes an invented cohort of adults with EGFR-mutated non-small cell lung cancer treated with Tagrisso at six fictional centers. Investigators reported that disease control held in most participants through the interim cutoff. Outcomes were assessed by blinded central review. The authors plan longer follow-up before drawing conclusions.",
    aspects: [
      ["efficacy", 2, "researcher", "Investigators reported that disease control held in most participants through the interim cutoff."],
      ["evidence_quality", 1, "researcher", "Outcomes were assessed by blinded central review."],
    ],
  },
  {
    n: 2, source: "news", product: "A", date: "2025-04-15", signal: "expert_opinion", actionable: "no",
    title: "Demo Health Wire: oncologists on first-line choices",
    text: "Demo Health Wire spoke with three community oncologists for this invented feature. Dr. Lena Ortiz, a fictional thoracic oncologist, said Tagrisso remains her default first-line option for most of her EGFR patients. She added that she reviews each case with her tumor board.",
    aspects: [
      ["efficacy", 1, "hcp", "said Tagrisso remains her default first-line option for most of her EGFR patients"],
    ],
  },
  {
    n: 3, source: "fda_label", product: "A", date: "2025-04-24", signal: "regulatory", actionable: "yes",
    title: "Synthetic label revision notice for Tagrisso (demo)",
    text: "This is an invented label revision used for demonstration. The revised section adds monitoring language for a cardiac adverse reaction. Prescribers are advised to assess cardiac function at baseline and during treatment as clinically indicated.",
    aspects: [
      ["safety", -1, "regulator", "The revised section adds monitoring language for a cardiac adverse reaction."],
    ],
  },
  {
    n: 4, source: "ctgov", product: "A", date: "2025-05-06", signal: "trial_update", actionable: "no",
    title: "Synthetic registry record: Tagrisso sequencing study (demo)",
    text: "Invented registry entry. Status changed from not yet recruiting to recruiting. The study is an open-label, single-arm design with an estimated enrollment of 120 participants across fictional sites.",
    aspects: [
      ["evidence_quality", 0, "researcher", "The study is an open-label, single-arm design with an estimated enrollment of 120 participants across fictional sites."],
    ],
  },
  {
    n: 5, source: "news", product: "A", date: "2025-05-14", signal: "access_pricing", actionable: "yes",
    title: "Northfield Health Plan adds prior authorization step (fictional)",
    text: "Northfield Health Plan, a fictional regional insurer, told members it will add a prior authorization step for several oral targeted therapies, including Tagrisso. A plan pharmacist said the extra step could add days before a first fill. The plan said appeals will be reviewed within five business days.",
    aspects: [
      ["access_cost", -1, "payer", "A plan pharmacist said the extra step could add days before a first fill."],
    ],
  },
  {
    n: 6, source: "press_release", product: "A", date: "2025-05-28", signal: "efficacy", actionable: "no",
    title: "Synthetic company release: Tagrisso program update",
    text: "In this invented release, the company said new long-term data from a fictional extension study reinforce the role of Tagrisso in EGFR-mutated disease. The company will present the synthetic results at a fictional autumn congress.",
    aspects: [
      ["efficacy", 2, "company", "the company said new long-term data from a fictional extension study reinforce the role of Tagrisso in EGFR-mutated disease"],
    ],
  },
  {
    n: 7, source: "fda_event", product: "A", date: "2025-06-10", signal: "safety", actionable: "no",
    title: "Synthetic adverse event report cluster (demo)",
    text: "Invented adverse event summary. A reporting clinician described a patient on Tagrisso who developed a rash that resolved after a short dose interruption. No hospitalization was reported.",
    aspects: [
      ["safety", -1, "hcp", "A reporting clinician described a patient on Tagrisso who developed a rash that resolved after a short dose interruption."],
    ],
  },
  {
    n: 8, source: "pubmed", product: "A", date: "2025-06-18", signal: "safety", actionable: "no",
    title: "Real-world tolerability of Tagrisso in a fictional registry",
    text: "This synthetic study pooled invented records from a fictional national registry. Diarrhea and skin events were the most frequently recorded adverse events, and most were low grade. The registry used standardized adverse event coding across all contributing sites.",
    aspects: [
      ["safety", -1, "researcher", "Diarrhea and skin events were the most frequently recorded adverse events, and most were low grade."],
      ["evidence_quality", 1, "researcher", "The registry used standardized adverse event coding across all contributing sites."],
    ],
  },
  {
    n: 9, source: "news", product: "A", date: "2025-06-25", signal: "expert_opinion", actionable: "no",
    title: "Clinic Notes (fictional podcast): talking adjuvant care",
    text: "On an invented episode of Clinic Notes, a fictional oncology nurse practitioner discussed oral targeted therapy. She said most of her patients on Tagrisso keep working through treatment. She also said she checks in early about skin care because rash is the first thing patients ask about.",
    aspects: [
      ["efficacy", 1, "hcp", "She said most of her patients on Tagrisso keep working through treatment."],
      ["safety", -1, "hcp", "she checks in early about skin care because rash is the first thing patients ask about"],
    ],
  },
  {
    n: 10, source: "news", product: "A", date: "2025-07-09", signal: "access_pricing", actionable: "yes",
    title: "Fictional insurer drops step therapy rule",
    text: "Lakeshore Mutual, a fictional insurer, said it will remove a step therapy requirement for EGFR-targeted oral therapies starting next quarter. A plan spokesperson said the change lets members start Tagrisso without first trying another drug.",
    aspects: [
      ["access_cost", 1, "payer", "A plan spokesperson said the change lets members start Tagrisso without first trying another drug."],
    ],
  },
  {
    n: 11, source: "fda_notice", product: "A", date: "2025-07-22", signal: "regulatory", actionable: "yes",
    title: "Synthetic agency notice: manufacturing site update (demo)",
    text: "This invented notice announces that an additional fictional manufacturing site has been approved for Tagrisso tablets. The notice states that no change to the product labeling or safety information is required.",
    aspects: [
      ["safety", 0, "regulator", "The notice states that no change to the product labeling or safety information is required."],
    ],
  },
  {
    n: 12, source: "pubmed", product: "A", date: "2025-08-05", signal: "efficacy", actionable: "no",
    title: "Retrospective look at Tagrisso dose adjustments (synthetic)",
    text: "This synthetic retrospective review used invented chart data from two fictional hospitals. Patients who needed a dose reduction appeared to stay on treatment as long as those who did not. Because the review was retrospective and small, the authors caution that selection bias is likely.",
    aspects: [
      ["efficacy", 1, "researcher", "Patients who needed a dose reduction appeared to stay on treatment as long as those who did not."],
      ["evidence_quality", -1, "researcher", "Because the review was retrospective and small, the authors caution that selection bias is likely."],
    ],
  },
  {
    n: 13, source: "news", product: "A", date: "2025-08-13", signal: "none", actionable: "no",
    title: "Patient voices (fictional blog): a year on a daily pill",
    text: "In this invented blog post, a fictional patient named Sam writes about a year on Tagrisso. Sam says the dry skin and cracked fingertips were the hardest part of the first months. Sam also writes about learning to cook again.",
    aspects: [
      ["safety", -1, "patient", "Sam says the dry skin and cracked fingertips were the hardest part of the first months."],
    ],
  },
  {
    n: 14, source: "ctgov", product: "A", date: "2025-08-26", signal: "trial_update", actionable: "no",
    title: "Synthetic registry record: randomized comparison (demo)",
    text: "Invented registry update. The primary outcome was revised to include independent central review. The design is randomized and double-blind with a planned enrollment of 400 participants.",
    aspects: [
      ["evidence_quality", 1, "researcher", "The design is randomized and double-blind with a planned enrollment of 400 participants."],
    ],
  },
  {
    n: 15, source: "news", product: "A", date: "2025-09-02", signal: "expert_opinion", actionable: "yes",
    title: "Fictional roundtable: what changed this year",
    text: "At an invented regional roundtable, a fictional panel of oncologists compared notes. One oncologist said the long-term data make her more confident starting Tagrisso early. Another said cardiac monitoring has become a routine part of her follow-up visits.",
    aspects: [
      ["efficacy", 2, "hcp", "One oncologist said the long-term data make her more confident starting Tagrisso early."],
      ["safety", -1, "hcp", "Another said cardiac monitoring has become a routine part of her follow-up visits."],
    ],
  },
  {
    n: 16, source: "fda_event", product: "A", date: "2025-09-10", signal: "safety", actionable: "no",
    title: "Synthetic adverse event report (demo)",
    text: "Invented adverse event summary. A pharmacist reported a patient on Tagrisso with a decrease in a cardiac function measure found at a routine check. The patient continued treatment with closer monitoring.",
    aspects: [
      ["safety", -1, "hcp", "A pharmacist reported a patient on Tagrisso with a decrease in a cardiac function measure found at a routine check."],
    ],
  },
  {
    n: 17, source: "news", product: "A", date: "2025-09-17", signal: "access_pricing", actionable: "yes",
    title: "Fictional benefits manager raises specialty copays",
    text: "Crestline Rx, a fictional pharmacy benefits manager, said specialty tier copays will rise next year for several oral cancer drugs, Tagrisso among them. A Crestline spokesperson said members can apply for the manufacturer support program to offset the change.",
    aspects: [
      ["access_cost", -1, "payer", "said specialty tier copays will rise next year for several oral cancer drugs, Tagrisso among them"],
    ],
  },
  {
    n: 18, source: "pubmed", product: "A", date: "2025-09-24", signal: "efficacy", actionable: "no",
    title: "Synthetic pooled analysis of Tagrisso in brain metastases",
    text: "This synthetic pooled analysis combined invented data from three fictional studies. Intracranial disease control was reported in a majority of evaluable participants. The pooled studies used a common imaging schedule and the same response criteria.",
    aspects: [
      ["efficacy", 1, "researcher", "Intracranial disease control was reported in a majority of evaluable participants."],
      ["evidence_quality", 1, "researcher", "The pooled studies used a common imaging schedule and the same response criteria."],
    ],
  },
  {
    n: 19, source: "fda_label", product: "A", date: "2025-10-01", signal: "regulatory", actionable: "yes",
    title: "Synthetic label revision: warnings section (demo)",
    text: "This invented label revision updates the warnings section for Tagrisso. The revision adds a recommendation to evaluate patients promptly for new respiratory symptoms. No new indication is included in this revision.",
    aspects: [
      ["safety", -1, "regulator", "The revision adds a recommendation to evaluate patients promptly for new respiratory symptoms."],
    ],
  },
  {
    n: 20, source: "pubmed", product: "A", date: "2025-10-02", signal: "efficacy", actionable: "no",
    title: "Synthetic cohort update from a fictional cancer network",
    text: "This invented update reports a second interim look at a fictional network cohort on Tagrisso. Median time on treatment was longer than at the first interim look. Data were collected through routine care rather than a study protocol.",
    aspects: [
      ["efficacy", 1, "researcher", "Median time on treatment was longer than at the first interim look."],
    ],
  },
  {
    n: 21, source: "news", product: "A", date: "2025-10-08", signal: "none", actionable: "no",
    title: "Fictional patient forum digest",
    text: "An invented digest of a fictional patient forum summarized recent posts from people taking Tagrisso. Several members wrote that their energy came back after the first few months. A few described ongoing nail problems that make buttons and zippers hard.",
    aspects: [
      ["efficacy", 1, "patient", "Several members wrote that their energy came back after the first few months."],
      ["safety", -1, "patient", "A few described ongoing nail problems that make buttons and zippers hard."],
    ],
  },
  {
    n: 22, source: "pubmed", product: "A", date: "2025-10-09", signal: "efficacy", actionable: "yes",
    title: "Synthetic biomarker-stratified analysis (demo)",
    text: "This synthetic analysis split an invented cohort by EGFR variant. Benefit was observed in both variant groups in this fictional dataset. The analysis was prespecified and used a validated central assay.",
    aspects: [
      ["efficacy", 2, "researcher", "Benefit was observed in both variant groups in this fictional dataset."],
      ["evidence_quality", 2, "researcher", "The analysis was prespecified and used a validated central assay."],
    ],
  },
  {
    n: 23, source: "press_release", product: "A", date: "2025-10-15", signal: "competitor_move", actionable: "no",
    title: "Synthetic company release: patient support expansion",
    text: "In this invented release, the company announced an expanded patient support program for Tagrisso. The company said the program now covers transportation to monitoring visits in more fictional regions.",
    aspects: [
      ["access_cost", 1, "company", "The company said the program now covers transportation to monitoring visits in more fictional regions."],
    ],
  },
  // ---------------- Product B ----------------
  {
    n: 24, source: "pubmed", product: "B", date: "2025-04-08", signal: "efficacy", actionable: "yes",
    title: "Rybrevant plus Lazcluze in a fictional first-line cohort (synthetic)",
    text: "This synthetic abstract reports an invented first-line cohort treated with Rybrevant plus Lazcluze. Investigators reported durable responses in most participants at the data cutoff. The cohort was enrolled prospectively with independent response review.",
    aspects: [
      ["efficacy", 2, "researcher", "Investigators reported durable responses in most participants at the data cutoff."],
      ["evidence_quality", 1, "researcher", "The cohort was enrolled prospectively with independent response review."],
    ],
  },
  {
    n: 25, source: "press_release", product: "B", date: "2025-04-22", signal: "regulatory", actionable: "yes",
    title: "Synthetic company release: administration options",
    text: "In this invented release, the company said it is studying administration options for Rybrevant intended to shorten time in the infusion chair. The company did not give a timeline.",
    aspects: [
      ["convenience", 2, "company", "the company said it is studying administration options for Rybrevant intended to shorten time in the infusion chair"],
    ],
  },
  {
    n: 26, source: "news", product: "B", date: "2025-05-07", signal: "expert_opinion", actionable: "no",
    title: "Demo Health Wire: infusion day in a community clinic",
    text: "For this invented feature, Demo Health Wire visited a fictional community infusion center. A charge nurse said the first Rybrevant infusion takes the most planning because staff watch closely for reactions. She said later visits are shorter.",
    aspects: [
      ["safety", -1, "hcp", "the first Rybrevant infusion takes the most planning because staff watch closely for reactions"],
    ],
  },
  {
    n: 27, source: "ctgov", product: "B", date: "2025-05-20", signal: "trial_update", actionable: "no",
    title: "Synthetic registry record: combination study (demo)",
    text: "Invented registry entry for a fictional study of Rybrevant with Lazcluze. Enrollment target increased from 200 to 260 participants. The design remains open-label.",
    aspects: [
      ["evidence_quality", 0, "researcher", "The design remains open-label."],
    ],
  },
  {
    n: 28, source: "news", product: "B", date: "2025-06-03", signal: "access_pricing", actionable: "yes",
    title: "Fictional health system flags infusion cost review",
    text: "Riverbend Health, a fictional integrated health system, said its payer arm will review site-of-care rules for infused cancer drugs, including Rybrevant. A payer medical director said infusions may be steered away from hospital outpatient departments, which could disrupt established care.",
    aspects: [
      ["access_cost", -2, "payer", "A payer medical director said infusions may be steered away from hospital outpatient departments, which could disrupt established care."],
    ],
  },
  {
    n: 29, source: "fda_event", product: "B", date: "2025-06-17", signal: "safety", actionable: "no",
    title: "Synthetic adverse event report (demo)",
    text: "Invented adverse event summary. A reporting physician described an infusion-related reaction during a first Rybrevant dose that resolved after the infusion was paused. The patient completed the infusion later that day.",
    aspects: [
      ["safety", -1, "hcp", "A reporting physician described an infusion-related reaction during a first Rybrevant dose that resolved after the infusion was paused."],
    ],
  },
  {
    n: 30, source: "news", product: "B", date: "2025-06-24", signal: "none", actionable: "no",
    title: "Patient voices (fictional blog): split infusion days",
    text: "In this invented post, a fictional patient named Priya writes about starting Rybrevant. Priya says the first dose was split over two days and she spent most of both in the clinic. She writes that her skin flared in the first month.",
    aspects: [
      ["convenience", -1, "patient", "Priya says the first dose was split over two days and she spent most of both in the clinic."],
      ["safety", -1, "patient", "She writes that her skin flared in the first month."],
    ],
  },
  {
    n: 31, source: "pubmed", product: "B", date: "2025-07-08", signal: "efficacy", actionable: "no",
    title: "Synthetic subgroup report for Rybrevant combination (demo)",
    text: "This synthetic report covers an invented subgroup from a fictional combination study. Responses were seen across the prespecified subgroups. Subgroups were defined before unblinding and analyzed with a common model.",
    aspects: [
      ["efficacy", 1, "researcher", "Responses were seen across the prespecified subgroups."],
      ["evidence_quality", 1, "researcher", "Subgroups were defined before unblinding and analyzed with a common model."],
    ],
  },
  {
    n: 32, source: "news", product: "B", date: "2025-07-22", signal: "access_pricing", actionable: "yes",
    title: "Fictional insurer adds combination to medical policy",
    text: "Northfield Health Plan, a fictional insurer, added Rybrevant with Lazcluze to its oncology medical policy. A plan pharmacist said coverage requires documented EGFR testing, which some clinics find slow to obtain.",
    aspects: [
      ["access_cost", -1, "payer", "A plan pharmacist said coverage requires documented EGFR testing, which some clinics find slow to obtain."],
    ],
  },
  {
    n: 33, source: "fda_label", product: "B", date: "2025-08-05", signal: "regulatory", actionable: "yes",
    title: "Synthetic label revision for Rybrevant (demo)",
    text: "This invented label revision adds guidance on preventing venous thromboembolic events in the first months of combination treatment. The revision recommends prophylactic anticoagulation be considered for eligible patients.",
    aspects: [
      ["safety", -1, "regulator", "adds guidance on preventing venous thromboembolic events in the first months of combination treatment"],
    ],
  },
  {
    n: 34, source: "news", product: "B", date: "2025-08-12", signal: "expert_opinion", actionable: "no",
    title: "Fictional tumor board notes on the combination",
    text: "At an invented tumor board, a fictional thoracic oncologist walked through a case on Rybrevant with Lazcluze. He said the skin toxicity needs a plan from day one. He also said the infusion schedule is a real burden for patients who live far from the clinic.",
    aspects: [
      ["safety", -1, "hcp", "He said the skin toxicity needs a plan from day one."],
      ["convenience", -1, "hcp", "the infusion schedule is a real burden for patients who live far from the clinic"],
    ],
  },
  {
    n: 35, source: "press_release", product: "B", date: "2025-08-27", signal: "efficacy", actionable: "no",
    title: "Synthetic company release: combination data update",
    text: "In this invented release, the company said updated fictional data show the Rybrevant and Lazcluze combination continued to perform well with longer follow-up. Full synthetic results will be shared at a fictional congress.",
    aspects: [
      ["efficacy", 2, "company", "the company said updated fictional data show the Rybrevant and Lazcluze combination continued to perform well with longer follow-up"],
    ],
  },
  {
    n: 36, source: "news", product: "B", date: "2025-09-24", signal: "none", actionable: "no",
    title: "Patient voices (fictional blog): shorter visits now",
    text: "In a follow-up invented post, Priya writes that her Rybrevant visits are much shorter now than in the first weeks. She says she can get back to work the same afternoon.",
    aspects: [
      ["convenience", 1, "patient", "Priya writes that her Rybrevant visits are much shorter now than in the first weeks."],
    ],
  },
  {
    n: 37, source: "news", product: "B", date: "2025-10-01", signal: "expert_opinion", actionable: "no",
    title: "Demo Health Wire: what clinicians are watching",
    text: "For this invented story, Demo Health Wire asked fictional oncologists what they are watching this year. One said the combination of Rybrevant and Lazcluze has become a real option for her fit first-line patients.",
    aspects: [
      ["efficacy", 1, "hcp", "One said the combination of Rybrevant and Lazcluze has become a real option for her fit first-line patients."],
    ],
  },
  {
    n: 38, source: "fda_notice", product: "B", date: "2025-09-23", signal: "regulatory", actionable: "no",
    title: "Synthetic agency notice: labeling format update (demo)",
    text: "This invented notice reformats the Rybrevant labeling to a new structured layout. The notice states that the safety content is unchanged.",
    aspects: [
      ["safety", 0, "regulator", "The notice states that the safety content is unchanged."],
    ],
  },
  {
    n: 39, source: "news", product: "B", date: "2025-10-02", signal: "none", actionable: "no",
    title: "Fictional patient forum digest: combination therapy",
    text: "An invented digest of a fictional patient forum covered posts from people on Rybrevant with Lazcluze. Several members said the shorter clinic visits made the schedule easier to manage. Others still mentioned skin problems around the nails.",
    aspects: [
      ["convenience", 1, "patient", "Several members said the shorter clinic visits made the schedule easier to manage."],
      ["safety", -1, "patient", "Others still mentioned skin problems around the nails."],
    ],
  },
  {
    n: 40, source: "news", product: "B", date: "2025-10-08", signal: "expert_opinion", actionable: "yes",
    title: "Fictional oncology society webinar recap",
    text: "In an invented webinar recap, a fictional oncologist said the longer follow-up for Rybrevant with Lazcluze has changed how she frames first-line options. She said she now discusses it with every eligible patient.",
    aspects: [
      ["efficacy", 1, "hcp", "said the longer follow-up for Rybrevant with Lazcluze has changed how she frames first-line options"],
    ],
  },
  {
    n: 41, source: "pubmed", product: "B", date: "2025-10-14", signal: "efficacy", actionable: "no",
    title: "Synthetic exploratory analysis of the combination (demo)",
    text: "This synthetic exploratory analysis used invented data from a fictional combination cohort. Response durability appeared similar across age groups.",
    aspects: [
      ["efficacy", 1, "researcher", "Response durability appeared similar across age groups."],
    ],
  },
  {
    n: 42, source: "news", product: "B", date: "2025-10-21", signal: "none", actionable: "no",
    title: "Demo Health Wire explainer: infusion versus pill",
    text: "This invented explainer from Demo Health Wire compares treatment logistics. The writer notes that infused regimens need clinic time while oral pills do not. The piece says cost to patients depends heavily on each plan's benefit design.",
    aspects: [
      ["convenience", 0, "media", "The writer notes that infused regimens need clinic time while oral pills do not."],
      ["access_cost", 0, "media", "The piece says cost to patients depends heavily on each plan's benefit design."],
    ],
  },
  {
    n: 43, source: "news", product: "B", date: "2025-07-15", signal: "none", actionable: "no",
    title: "Fictional newsletter mention",
    text: "A fictional industry newsletter briefly listed Rybrevant among therapies with new patient education materials. The newsletter said the materials explain what to expect on infusion days.",
    aspects: [
      ["convenience", 0, "media", "The newsletter said the materials explain what to expect on infusion days."],
    ],
  },
  // ---------------- Both products ----------------
  {
    n: 44, source: "news", product: "both", date: "2025-06-11", signal: "competitor_move", actionable: "no",
    title: "Demo Health Wire: two EGFR strategies",
    text: "This invented analysis piece from Demo Health Wire looks at Tagrisso and the Rybrevant with Lazcluze combination. The writer says the two strategies are now discussed side by side at many fictional clinics. It notes that the regimens and studied populations differ.",
    aspects: [
      ["efficacy", 0, "media", "The writer says the two strategies are now discussed side by side at many fictional clinics."],
    ],
  },
  {
    n: 45, source: "pubmed", product: "both", date: "2025-08-19", signal: "guideline", actionable: "no",
    title: "Synthetic narrative review of first-line EGFR options",
    text: "This synthetic narrative review summarizes invented evidence on first-line options including Tagrisso and Rybrevant with Lazcluze. The authors note that no head-to-head comparison exists and cross-trial comparisons are unreliable.",
    aspects: [
      ["evidence_quality", -1, "researcher", "The authors note that no head-to-head comparison exists and cross-trial comparisons are unreliable."],
    ],
  },
  {
    n: 46, source: "news", product: "both", date: "2025-10-14", signal: "guideline", actionable: "yes",
    title: "Fictional guideline committee update",
    text: "A fictional regional guideline committee published an invented update to its EGFR pathway. A committee member, a fictional oncologist, said both Tagrisso and the Rybrevant combination are listed as preferred first-line options in the update.",
    aspects: [
      ["efficacy", 1, "hcp", "said both Tagrisso and the Rybrevant combination are listed as preferred first-line options in the update"],
    ],
  },
  // ---------- Lung safety mentions (ILD / pneumonitis). Also invented, for the lung pins ----------
  {
    n: 47, source: "fda_event", product: "A", date: "2025-07-16", signal: "safety", actionable: "no",
    title: "Synthetic adverse event narrative (demo)",
    text: "This invented report describes a fictional adult on Tagrisso. A reporting physician described pneumonitis that led to the treatment being stopped. The narrative states that the patient recovered after supportive care.",
    aspects: [
      ["safety", -2, "hcp", "A reporting physician described pneumonitis that led to the treatment being stopped."],
    ],
  },
  {
    n: 48, source: "news", product: "B", date: "2025-08-20", signal: "none", actionable: "no",
    title: "Demo Patient Voices: questions at every visit",
    text: "An invented patient forum post comes from Jordan, a fictional patient on Rybrevant with Lazcluze. Jordan wrote that the team asks about new cough at every visit because interstitial lung disease is on their checklist. Jordan said the questions take a minute.",
    aspects: [
      ["safety", -1, "patient", "Jordan wrote that the team asks about new cough at every visit because interstitial lung disease is on their checklist."],
      ["convenience", 1, "patient", "Jordan said the questions take a minute."],
    ],
  },
  {
    n: 49, source: "pubmed", product: "A", date: "2025-09-10", signal: "safety", actionable: "no",
    title: "Synthetic safety follow-up from a fictional registry",
    text: "This synthetic abstract summarizes an invented registry of adults on Tagrisso. Investigators reported no new cases of ILD after the first interim cutoff. The registry relies on clinician reporting and may miss mild events.",
    aspects: [
      ["safety", 1, "researcher", "Investigators reported no new cases of ILD after the first interim cutoff."],
      ["evidence_quality", -1, "researcher", "The registry relies on clinician reporting and may miss mild events."],
    ],
  },
  {
    n: 50, source: "ctgov", product: "A", date: "2025-09-24", signal: "trial_update", actionable: "no",
    title: "Synthetic registry entry: fictional Tagrisso study",
    text: "This invented registry entry describes a fictional study of Tagrisso. People with a history of interstitial lung disease are not eligible to enroll. Enrollment status changed to recruiting at four fictional sites.",
    aspects: [
      ["evidence_quality", 0, "researcher", "Enrollment status changed to recruiting at four fictional sites."],
    ],
  },
];

export interface SeedCard {
  id: string;
  headline: string;
  signal_type: SignalType;
  product: Product;
  week: string;
  cite: [number, AspectKey][];
  why: string;
  fact: string;
  observed: string;
  interpretation: string;
}

export const SEED_CARDS: SeedCard[] = [
  {
    id: "card-SYN-0019", headline: "Tagrisso label revision adds respiratory symptom evaluation", signal_type: "regulatory",
    product: "A", week: "2025-W40", cite: [[19, "safety"], [3, "safety"]],
    why: "Label change with clinical meaning. Route to messaging and medical-information review.",
    fact: "A synthetic label revision for Tagrisso adds a recommendation to evaluate new respiratory symptoms promptly.",
    observed: "Regulator safety polarity is −1 in both cited label items.",
    interpretation: "Field materials may need the updated warning language.",
  },
  {
    id: "card-SYN-0017", headline: "Payer friction on Tagrisso: specialty copays and prior authorization", signal_type: "access_pricing",
    product: "A", week: "2025-W38", cite: [[17, "access_cost"], [5, "access_cost"]],
    why: "Coverage or cost change. Route to access planning.",
    fact: "A fictional benefits manager says specialty tier copays will rise for oral cancer drugs including Tagrisso.",
    observed: "Payer access polarity is −1 in W20 and W38, with one +1 item in W28.",
    interpretation: "Watch for patient support program demand.",
  },
  {
    id: "card-SYN-0036", headline: "Rybrevant patients describe shorter clinic visits", signal_type: "none",
    product: "B", week: "2025-W40", cite: [[36, "convenience"], [39, "convenience"], [30, "convenience"]],
    why: "Patient voice on treatment burden. Useful context for nurse education and patient materials.",
    fact: "Two synthetic patient sources in W39 and W40 describe shorter Rybrevant clinic visits.",
    observed: "Patient convenience moved from −1 in W26 to +1 in W39 and W40.",
    interpretation: "The first weeks of treatment look like the burden point.",
  },
  {
    id: "card-SYN-0040", headline: "Clinicians frame Rybrevant with Lazcluze as a first-line option", signal_type: "expert_opinion",
    product: "B", week: "2025-W41", cite: [[40, "efficacy"], [37, "efficacy"]],
    why: "Shift in clinician framing. Medical affairs may want to hear it firsthand at an advisory board.",
    fact: "Two fictional oncologists in W40 and W41 describe the combination as a first-line option.",
    observed: "Clinician efficacy polarity is +1 in both weeks.",
    interpretation: "Two voices is thin. Treat this as a lead to follow up.",
  },
  {
    id: "card-SYN-0033", headline: "Rybrevant label revision adds thromboembolic prevention guidance", signal_type: "regulatory",
    product: "B", week: "2025-W32", cite: [[33, "safety"]],
    why: "Label change with clinical meaning. Route to messaging and medical-information review.",
    fact: "A synthetic label revision adds guidance on preventing venous thromboembolic events early in combination treatment.",
    observed: "Regulator safety polarity is −1.",
    interpretation: "Expect related questions from infusion nurses.",
  },
  {
    id: "card-SYN-0022", headline: "Tagrisso researcher efficacy signals hold across W39 to W41", signal_type: "efficacy",
    product: "A", week: "2025-W41", cite: [[22, "efficacy"], [20, "efficacy"], [18, "efficacy"]],
    why: "New efficacy evidence. Route to medical affairs for review against current messaging.",
    fact: "Three synthetic research items in consecutive weeks report disease control or longer time on treatment.",
    observed: "Researcher efficacy polarity is +1, +1 and +2.",
    interpretation: "Consistent direction, small N. All three come from invented cohorts.",
  },
];

/** A SYNTHETIC advisory-board style note for the intake demo. */
export const SAMPLE_TRANSCRIPT = {
  title: "SYNTHETIC advisory board note (demo)",
  product: "B" as Product,
  date: "2025-10-23",
  text: "SYNTHETIC DEMO TRANSCRIPT. Fictional advisory board, community oncology, October. Moderator asked about first-line combination therapy. A fictional oncologist said her infusion center now books Rybrevant patients in the afternoon block because visits after the first month are shorter. She said the prior authorization paperwork is still the slowest step for her clinic. Another participant said nurses want a one-page skin care handout.",
  aspects: [
    ["convenience", 1, "hcp", "visits after the first month are shorter"],
    ["access_cost", -1, "hcp", "She said the prior authorization paperwork is still the slowest step for her clinic."],
  ] as SeedAspect[],
};
