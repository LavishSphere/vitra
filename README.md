<p align="center">
  <img src="web/public/vitra-mark.svg" alt="Vitra" width="96" height="96" />
</p>

<h1 align="center">Vitra</h1>

<p align="center">
  <strong>Ashsmith Khayrul</strong> · HACK1984 · Signal-to-Dose
</p>

<p align="center">
  Reads public evidence on Tagrisso and Rybrevant, labels the launch signal, and ties every score to an exact quote. A 3B model does the reading on your own computer, with the Wi-Fi off.
</p>

<p align="center">
  <a href="https://vitra.khayrul.com">Live demo</a>
  ·
  <a href="#results">Results</a>
  ·
  <a href="#works-with-the-wi-fi-off">Wi-Fi off</a>
  ·
  <a href="#demo-video">Video</a>
  ·
  <a href="#setup">Setup</a>
</p>

<p align="center">
  <img src="web/screenshots/xray-click.gif" alt="Lung observatory into Evidence X-Ray" width="780" />
</p>
<p align="center">
  <sub>Synthetic data. Click a quote to open Evidence X-Ray. The lungs are illustrative; every quote is copied word for word from its source.</sub>
</p>

## What it does

Built for a launch-intelligence or medical-affairs lead on an EGFR lung cancer brand. They need week-over-week sentiment with citations they can open, and they can't paste confidential advisory-board notes into a cloud model.

For every item (trial registrations, FDA reports and labels, papers, press releases, news, or a pasted transcript), Vitra outputs:

- the signal type and whether a launch team should act on it
- a score from −2 to +2 on efficacy, safety, convenience, access and cost, and evidence quality
- who said it, and the exact quote behind each score

Those labels feed weekly trends, insight cards and evidence gaps. Click any score to land on the sentence it came from.

## Results

Organizer scorer (`score.py`) on the 60-item labeled dev set, 5-fold. The 240-item hidden test set is scored by the organizers.

| | Rules only | Rules + Llama 3.2 3B |
|---|---|---|
| Composite | 0.842 | 0.865 |
| Signal macro-F1 | 0.806 | 0.806 |
| Actionable F1 | 0.870 | 0.917 |
| Aspect F1 | 0.328 | 0.784 |
| Polarity QWK | 1.000 | 0.928 |
| Speaker accuracy | 1.000 | 1.000 |
| Span F1 | 0.892 | 0.623 |
| Citation validity | 1.000 | 1.000 |

- Both columns were tuned on dev, so they're optimistic. Counting only the caveat phrases the labeling guide lists, the model column scores 0.859.
- Rules fill only the few aspects they're sure of, so their quotes are tight. The model finds far more aspects (0.328 to 0.784) with looser quotes. Weakest area: efficacy on long PubMed abstracts.
- The full 240-item test run took 569 s on an Apple M5 MacBook Air (16 GB), about 2.4 s per item.

## Works with the Wi-Fi off

`scripts/run_offline.sh --check` refuses to start while the internet is reachable, then starts the model and API on `127.0.0.1`, runs one synthetic transcript through the model, and checks every Vitra process's sockets every 0.3 s. Any connection off the machine fails the run.

Captured on Nov 7 with Wi-Fi turned off:

```text
[vitra    0.0s] offline confirmed: https://example.com is unreachable
[vitra    0.2s] starting model server: Llama-3.2-3B-Instruct-Q4_K_M.gguf on 127.0.0.1:8080
[vitra    2.4s] model server ready
[vitra    3.2s] API ready (2033 items, model server up, Llama-3.2-3B-Instruct-Q4_K_M.gguf)
[vitra    3.2s] cold start complete (browser would open now)
[vitra    3.3s] API smoke: token enforced, 2033 evidence items served
[vitra]         intake status=complete, 2 verified span(s) (classifying 3637 ms)
[vitra    7.2s] no node process running under the launcher
[vitra    7.2s] network audit passed: every socket seen was loopback only
[vitra    7.2s] CHECK PASSED
```

Cold start to a working app took 3.2 s, and a pasted transcript came back with verified quotes in 3.6 s.

## One transcript, end to end

A synthetic advisory-board note, pasted into the app:

> Synthetic advisory board note. Thoracic oncologist: The subcutaneous version of amivantamab cuts chair time from hours to minutes, and our infusion center will love that. The rash is still a real concern for my patients and needs proactive management. Payer representative: prior authorization for the combination has been slow in our region.

What the local model returned, in 7.0 s:

| Aspect | Score | Speaker | Quote |
|---|---|---|---|
| Convenience | +1 | hcp | "cuts chair time from hours to minutes" |
| Safety | −1 | hcp | "still a real concern for my patients" |
| Access and cost | missed | | the prior-authorization line wasn't flagged in this run |

Both quotes are exact substrings of the note. The model also tried to file the chair-time quote under efficacy; Vitra keeps one aspect per quote, so it stays under convenience. In the app, the note joins the evidence, its quotes open in Evidence X-Ray, and the convenience and safety trends for Rybrevant update.

## How it works

1. **Rules** from the organizers' labeling guide handle the clear cases: trial registrations, FDA reports and labels, and who is speaking.
2. **Llama 3.2 3B** (Q4_K_M, via llama.cpp on `127.0.0.1`) labels the rest with a strict JSON schema.
3. **Quote check:** every quote must be found word for word in its source, or it's dropped.
4. **Aggregate:** weekly trends, evidence gaps, insight cards, and exclude/restore with a live recount.
5. **Serve:** the API and the web app run on the same local port; nothing is sent off the machine.

```
pipeline/   rules, model, quote check
app/        local API and launcher
web/        React and three.js
contracts/  shared data shapes
```

Real: the labels, quotes, trends and offline run. Illustrative: the 3D anatomy. Synthetic: everything on [vitra.khayrul.com](https://vitra.khayrul.com) and the transcript above. Not medical advice.

## Demo video

3 to 5 minute walkthrough on YouTube. Link coming: Wi-Fi off, cold start, lungs, Evidence X-Ray, one pasted transcript with real timings.

## Setup

Needs ~8 GB free RAM, Python 3.11+, Node 20+, `llama-server`, and the organizer package under `starter/` (gitignored; PubMed rehydrated).

### Linux / macOS

Install `llama-server` with `brew install llama.cpp`, or download a build from [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases).

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
(cd web && npm ci && npm run build)
# Model: Llama-3.2-3B-Instruct-Q4_K_M.gguf from huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF into models/
# sha256 6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff

scripts/run_offline.sh --check
scripts/run_offline.sh serve
```

`serve` prints `X-Vitra-Token for this launch: …` and opens `http://127.0.0.1:8000/#t=…`. No signup. No fixed token in the repo.

### Windows

In PowerShell from the repo root:

```powershell
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
cd web
npm ci
npm run build
cd ..
# Model: Llama-3.2-3B-Instruct-Q4_K_M.gguf from huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF into models\
# llama-server.exe: unzip a build from github.com/ggml-org/llama.cpp/releases (cpu-x64, cuda or vulkan),
# then put its folder on PATH or:
$env:VITRA_LLAMA_SERVER = "C:\llama.cpp\llama-server.exe"

scripts\run_offline.ps1 --check
scripts\run_offline.ps1 serve
```

If PowerShell blocks local scripts, use `scripts\run_offline.cmd --check` with the same arguments. Ctrl+C stops the model server and the API.

### Label and score the dev set

On Windows, use `.venv\Scripts\python.exe` in place of `.venv/bin/python`.

```bash
PKG=starter/hackathon_package_2026-11-05
.venv/bin/python -m pipeline.predict --items "$PKG/data/dev.full.jsonl" --out data/derived/dev_pred.jsonl
.venv/bin/python -m pipeline.predict --items "$PKG/data/unlabeled.full.jsonl" --out data/derived/predictions/unlabeled.jsonl
.venv/bin/python -I "$PKG/scoring/score.py" \
  --gold "$PKG/data/dev.jsonl" \
  --pred data/derived/dev_pred.jsonl \
  --items "$PKG/data/dev.full.jsonl"
```

## License

Code is MIT. The model is Llama 3.2 3B Instruct under the Llama 3.2 Community License (Built with Llama); its weights are not in this repository. Third-party licenses are in `LICENSES.md`. The organizer dataset is not included.
