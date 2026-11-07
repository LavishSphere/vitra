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

<p align="center">
  <img src="web/screenshots/xray-click.gif" alt="Lung observatory, then Evidence X-Ray with the cited span highlighted" width="720" />
</p>
<p align="center"><sub>Fixture demo: click a quote to open Evidence X-Ray. The lungs are illustrative; every span on screen is an exact substring of its source.</sub></p>

## Results (dev)

Scored with the organizers' `score.py` on the **60-item dev set**. The hidden 240-item test set is judged separately.

| Setup | Composite (dev) |
|---|---|
| Rules only (labeling guide code, r2) | 0.842 |
| Rules + Llama 3.2 3B hybrid (5-fold replay; later-clause span trim) | 0.8466 |

The hybrid split was picked and tuned on dev, so treat 0.8466 as an upper bound, not a test score. Signal type and speaker attribution are strong; aspect labels and exact quotes on longer pubmed and press items still drag the score (rules-only aspect F1 **0.328** on the same dev set).

## How it's put together

```
pipeline/    labeling: rules from the labeling guide, the local model, quote checking
app/         local API: evidence, trends, insight cards, transcript intake
web/         the interface: React, three.js, react-three-fiber
contracts/   the data shapes shared by all three
```

The model runs through llama.cpp on `127.0.0.1`. Nothing is sent to a cloud model.

Built with Llama. The model is Llama 3.2 3B Instruct (Q4_K_M), used under the Llama 3.2 Community License. Its weights aren't in this repository. Vitra's code is MIT; third-party licenses are listed in `LICENSES.md`.

## Data

The organizer dataset isn't in this repository. It's provided for HACK1984 only, and the package asks teams not to redistribute it. To run Vitra you need your own copy of the package, with the PubMed abstracts filled in by its `rehydrate` step.

## Try the public demo

Synthetic fixture build (no package text, no local model): [vitra.khayrul.com](https://vitra.khayrul.com)

## Setup and run (local, offline)

You need: Apple Silicon or Linux, ~8 GB free RAM for the 3B GGUF, Python 3.11+, Node 20+, [llama.cpp](https://github.com/ggerganov/llama.cpp) `llama-server` on your PATH, and the organizer package extracted under `starter/` (gitignored).

```bash
# 1. Python deps (once)
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# 2. Web build (once, while network is on)
(cd web && npm ci && npm run build)

# 3. Put Llama-3.2-3B-Instruct Q4_K_M at models/Llama-3.2-3B-Instruct-Q4_K_M.gguf
#    (weights are not in this repo; Llama 3.2 Community License)

# 4. Cold start with Wi-Fi off (binds 127.0.0.1 only)
scripts/run_offline.sh --check          # smoke + loopback audit
scripts/run_offline.sh serve            # API + web at http://127.0.0.1:8000/#t=<token>
```

Predict a split and score on the package (package path may differ on your machine):

```bash
.venv/bin/python -m pipeline.predict --split unlabeled --out data/derived/predictions/unlabeled.jsonl
PKG=starter/hackathon_package_2026-11-05
.venv/bin/python -I "$PKG/scoring/score.py" \
  --gold "$PKG/data/dev.jsonl" \
  --pred data/derived/dev_pred.jsonl \
  --items "$PKG/data/dev.full.jsonl"
```

Measured cost on an Apple M5 MacBook Air (16 GB): **268.3 wall seconds per 100 items** on the hybrid test run (logged). Organizer judging hardware is unknown; expect different times there.

## Network off

`scripts/run_offline.sh --check` refuses to run while `https://example.com` answers, starts the model and API on loopback only, serves the prebuilt web bundle same-origin, runs one SYNTHETIC intake, and audits sockets. Captured Wi-Fi-off output is in the local privacy proof notes (not published with package text).
