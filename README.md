<h1 align="center">Vitra</h1>
<p align="center">By <strong>Ashsmith Khayrul</strong> · HACK1984 · Signal-to-Dose track</p>

<p align="center">
  Every sentiment score on Tagrisso and Rybrevant, traced back to the exact sentence behind it. A 3B model does the reading, on your laptop, with the Wi-Fi off.
</p>

---

**Status:** being built during HACK1984, November 7 to 8, 2026. This README fills in as the pieces land.

## What it does

Launch teams for Tagrisso (osimertinib) and Rybrevant / Lazcluze (amivantamab, lazertinib) follow a constant stream of trial registrations, FDA reports, label changes, papers, press releases and news. Vitra reads each item and labels it:

- what kind of signal it is (efficacy, safety, regulatory, trial update, competitor move, access and pricing, guideline, expert opinion)
- whether a launch team should act on it
- how it judges the drug on five aspects (efficacy, safety, convenience, access and cost, evidence quality), each with a score from −2 to +2, the speaker, and a quote copied word for word from the source

Those labels feed week-by-week sentiment trends and insight cards. You can click any score and land on the sentence it came from.

## Results (dev)

Scored with the organizers' `score.py` on the **60-item dev set**. The hidden 240-item test set is judged separately.

| Setup | Composite (dev) |
|---|---|
| Rules only (labeling guide code, r2) | 0.842 |
| Rules + Llama 3.2 3B hybrid (5-fold on pubmed, press, news) | 0.844 |

The hybrid split was picked on dev, so treat 0.844 as an upper bound, not a test score. Signal type and speaker attribution are strong; aspect labels and exact quotes on longer pubmed and press items still drag the score (rules-only aspect F1 **0.328** on the same dev set).

## How it's put together

```
pipeline/    labeling: rules from the labeling guide, the local model, quote checking
app/         local API: evidence, trends, insight cards, transcript intake
web/         the interface: React, three.js, react-three-fiber
contracts/   the data shapes shared by all three
```

The model runs through llama.cpp on `127.0.0.1`. Nothing is sent to a cloud model.

## Data

The organizer dataset isn't in this repository. It's provided for HACK1984 only, and the package asks teams not to redistribute it. To run Vitra you need your own copy of the package, with the PubMed abstracts filled in by its `rehydrate` step.

Setup and run instructions are coming.
