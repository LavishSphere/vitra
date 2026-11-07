<p align="center">
  <img src="web/public/vitra-mark.svg" alt="Vitra" width="96" height="96" />
</p>

<h1 align="center">Vitra</h1>

<p align="center">
  <strong>Ashsmith Khayrul</strong> · HACK1984 · Signal-to-Dose
</p>

<p align="center">
  Every sentiment score on Tagrisso and Rybrevant, traced to the exact sentence behind it.<br />
  A 3B model does the reading on your machine, with no Wi-Fi.
</p>

<p align="center">
  <a href="https://vitra.khayrul.com">Live demo</a>
  ·
  <a href="#results-dev">Results</a>
  ·
  <a href="#setup-and-run-local-offline">Run offline</a>
</p>

<p align="center">
  <img src="web/screenshots/xray-click.gif" alt="Lung observatory into Evidence X-Ray" width="780" />
</p>
<p align="center">
  <sub>Synthetic fixture. Click a quote → Evidence X-Ray. Lungs are illustrative; every span is an exact substring of its source.</sub>
</p>

<p align="center">
  <img src="web/screenshots/01-observatory-1440.png" alt="Lung observatory" width="380" />
  &nbsp;
  <img src="web/screenshots/02-xray-1440.png" alt="Evidence X-Ray" width="380" />
</p>

## What it does

Launch teams for Tagrisso (osimertinib) and Rybrevant / Lazcluze (amivantamab, lazertinib) drown in trials, FDA reports, labels, papers, press, and news. Vitra labels each item:

- signal type (efficacy, safety, regulatory, trial update, competitor move, access and pricing, guideline, expert opinion)
- whether a launch team should act
- five aspects (efficacy, safety, convenience, access and cost, evidence quality), each −2 to +2, with speaker and a word-for-word quote

Those labels become week-by-week trends and insight cards. Click any score and land on the sentence.

## Results (dev)

Scored with the organizers' `score.py` on the **60-item dev set**. The hidden 240-item test set is judged separately.

| Setup | Composite (dev) |
|---|---|
| Rules only (labeling guide code, r2) | 0.842 |
| Rules + Llama 3.2 3B hybrid (5-fold replay; later-clause span trim) | 0.8466 |

0.8466 was picked and tuned on dev, so treat it as an upper bound. Signal type and speaker are strong; aspect labels and quotes on longer PubMed / press items still drag (rules-only aspect F1 **0.328**).

Measured cost on an Apple M5 MacBook Air (16 GB): **268.3 wall seconds per 100 items** (hybrid test run, logged). Organizer hardware is unknown.

## How it's put together

```
pipeline/    rules from the labeling guide + local model + quote checks
app/         local API: evidence, trends, cards, transcript intake
web/         React + three.js / react-three-fiber
contracts/   shared data shapes
```

Inference is llama.cpp on `127.0.0.1`. No cloud model. Weights: Llama 3.2 3B Instruct Q4_K_M (Llama 3.2 Community License; not in this repo). Code is MIT; see `LICENSES.md`.

**Real:** labels, spans, trends, offline run. **Illustrative:** 3D anatomy. **Synthetic:** phone demo data on [vitra.khayrul.com](https://vitra.khayrul.com). Not medical advice.

## Data

The organizer package is not in this repository (HACK1984 only; do not redistribute). You need your own copy with PubMed abstracts rehydrated.

## Setup and run (local, offline)

Needs: Apple Silicon or Linux, ~8 GB free RAM for the GGUF, Python 3.11+, Node 20+, `llama-server` on PATH, organizer package under `starter/` (gitignored).

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
(cd web && npm ci && npm run build)
# models/Llama-3.2-3B-Instruct-Q4_K_M.gguf  (weights not in repo)

scripts/run_offline.sh --check    # smoke + loopback audit (Wi-Fi off)
scripts/run_offline.sh serve      # API + web; opens the browser
```

`serve` prints `X-Vitra-Token for this launch: …` and opens `http://127.0.0.1:8000/#t=…` with that value in the URL fragment. No signup. No fixed token in the repo. If the browser does not open, copy the printed URL.

```bash
.venv/bin/python -m pipeline.predict --split unlabeled --out data/derived/predictions/unlabeled.jsonl
PKG=starter/hackathon_package_2026-11-05
.venv/bin/python -I "$PKG/scoring/score.py" \
  --gold "$PKG/data/dev.jsonl" \
  --pred data/derived/dev_pred.jsonl \
  --items "$PKG/data/dev.full.jsonl"
```

## Network off

`scripts/run_offline.sh --check` refuses to run while `https://example.com` answers, starts model + API on loopback only, serves the prebuilt web same-origin, runs one SYNTHETIC intake, and audits sockets.
