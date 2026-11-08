# Vitra data contract (v1.2)

This is the shared shape between `pipeline/` (Python), `app/` (FastAPI) and `web/` (React). Changing it means bumping the version here and noting it in the change log at the bottom. `contracts/types.ts` mirrors this file for the frontend.

## 1. Prediction (organizer format; never change it)
One JSON object per item, exactly as in the package README:
```json
{"item_id":"NW-0008","signal_type":"efficacy","actionable":"yes",
 "efficacy":{"polarity":2,"speaker":"company","span":"..."},
 "safety":null,"convenience":null,"access_cost":null,"evidence_quality":null}
```
- `signal_type` ∈ efficacy | safety | regulatory | trial_update | competitor_move | access_pricing | guideline | expert_opinion | none
- `actionable` ∈ yes | no
- aspect keys: efficacy | safety | convenience | access_cost | evidence_quality. Each is `null` or `{polarity: -2..2, speaker, span}`.
- `speaker` ∈ researcher | hcp | patient | company | regulator | payer | media
- Invariant: `span in item.text` (exact, case-sensitive).

## 2. Python interface that `pipeline/` exposes (`app/` imports it)
```python
# pipeline/api.py
def classify_item(item: dict, *, use_model: bool = True) -> dict:
    """item has the package item fields (item_id, source, product, title, text, ...).
    Returns a Prediction (section 1) plus "_meta": {"method": "rule"|"model"|"mixed",
    "model": str|None, "prompt_version": str|None, "latency_ms": int,
    "dropped_spans": [{"aspect": str, "span": str, "reason": str}]}.
    Never raises on bad model output: returns an all-null 'none' prediction with the reason in _meta."""

def locate_span(span: str, text: str) -> tuple[int, int] | None:
    """Exact-substring location after snapping; None if unverifiable."""
```
Model server: llama-server at `http://127.0.0.1:8080`, owned by `pipeline/`. Config comes from env: `VITRA_LLM_URL`, `VITRA_LLM_KEY`, `VITRA_MODEL_PATH`, `VITRA_PROMPT_VERSION`.

## 3. EvidenceItem (what `app/` serves and `web/` renders)
```json
{
  "item_id": "SYN-0001",
  "source": "pubmed",
  "url": "https://...",
  "published": "2025-06-02",
  "iso_week": "2025-W23",
  "product": "A",
  "title": "...",
  "text": "... full source text ...",
  "signal_type": "efficacy",
  "actionable": "yes",
  "origin": "gold_dev | predicted | rule | private_transcript | synthetic_demo",
  "aspects": [
    {"aspect": "efficacy", "polarity": 2, "speaker": "researcher",
     "span": "...", "span_start": 120, "span_end": 168}
  ],
  "confidence": {
    "level": "high | medium | low",
    "method": "rule | model | mixed | gold",
    "span_verified": true,
    "source_authority": "regulator | registry | peer_reviewed | company | news | private",
    "corroborating_items": 3,
    "notes": ["..."]
  }
}
```
`aspects` holds only the non-null aspects. Spans without verified offsets are never included.

## 4. TrendCell
```json
{"week": "2025-W23", "product": "A", "speaker": "hcp", "aspect": "safety",
 "mean_polarity": -0.5, "n_items": 2, "n_sources": 2, "item_ids": ["FDA-0005","NW-0010"]}
```
- An empty cell has `mean_polarity: null` and `n_items: 0`. It is never 0.0.
- `speaker` may be `"all"` and `aspect` may be `"all"` for rollups.

## 5. InsightCard
```json
{"id": "card-SYN-0001", "headline": "...", "signal_type": "efficacy", "product": "A",
 "week": "2025-W23", "actionable": true,
 "why_it_matters": "...",
 "citations": [{"item_id": "SYN-0001", "aspect": "efficacy", "span": "...", "url": "...",
                "span_start": 120, "span_end": 168}],
 "confidence": {"level": "medium", "method": "model", "span_verified": true,
                "source_authority": "peer_reviewed", "corroborating_items": 1, "notes": []},
 "fact": "...", "observed_sentiment": "...", "interpretation": "..."}
```

## 6. EvidenceGap
```json
{"product": "B", "speaker": "payer", "aspect": "access_cost", "window_weeks": 8,
 "n_items_in_window": 0, "last_seen_week": "2025-W40"}
```
If the cell was never seen, `last_seen_week` is null.

## 7. IntakeResult (transcript intake)
```json
{"status": "complete | abstained | error",
 "stages": [{"name": "received_locally", "ms": 1}, {"name": "classifying", "ms": 2400},
            {"name": "validating_quotes", "ms": 3}, {"name": "incorporating", "ms": 12}],
 "evidence": "<EvidenceItem | null>", "rejected_spans": [{"aspect": "...", "span": "...", "reason": "..."}],
 "reason": null, "error": null}
```
`reason` explains an `abstained` result in plain words (e.g. "no aspect judged in the text").
The transcript is kept in memory only. It is never written to disk or logs.
On `complete`, `evidence.item_id` (e.g. `PT-0001`) is the id to pass to `DELETE /api/intake/{item_id}` to undo it. Ids are never reused within a process.

## 8. HTTP API (`app/`, binds 127.0.0.1:8000; `web/` dev server on 127.0.0.1:5173)
| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{status, model_loaded, model, prompt_version, n_items}` |
| GET | `/api/evidence?product=&aspect=&speaker=&source=&signal_type=&week_from=&week_to=&actionable=` | `EvidenceItem[]` (text truncated to 400 chars in lists) |
| GET | `/api/evidence/{item_id}` | `EvidenceItem` (full text) |
| GET | `/api/trends?product=&aspect=&speaker=&excluded=ID,ID` | `TrendCell[]` |
| GET | `/api/insights?product=&excluded=` | `InsightCard[]` |
| GET | `/api/gaps?window_weeks=8&max_items=1` | `EvidenceGap[]` (`max_items`: cells with at most this many items count as gaps; default 0) |
| POST | `/api/whatif` `{excluded_ids: [], product?, aspect?, speaker?}` | `{trends: TrendCell[], insights: InsightCard[]}` |
| POST | `/api/intake` `{text, title?, product?}` | `IntakeResult` |
| DELETE | `/api/intake/{item_id}` | `{ok: true, removed: item_id, trends_changed: bool}`. Removes one held transcript from memory; every view then equals the state before it was added. 404 `{detail: "no held transcript with that id"}` for any other id, including base evidence |
| POST | `/api/reset` | `{ok: true}`. Clears held transcripts and exclusions |
| GET | `/api/privacy/status` | `{bind_host, llm_url, outbound_allowed: false, transcripts_persisted: false, checks: [...]}` (facts only) |

- Auth: header `X-Vitra-Token` must match the per-launch token, which the backend prints at startup and the dev web reads from `VITE_VITRA_TOKEN`. `/api/health` is open.
- CORS: only `http://127.0.0.1:5173` and `http://localhost:5173`.

## 9. Synthetic fixtures (for `web/` before the API is live, and for the public demo)
`web/src/fixtures/*.json` follow sections 3 to 7, with `origin: "synthetic_demo"`, item_ids prefixed `SYN-`, and **invented text**. No package text is allowed.

## Change log
- v1 (2026-11-07 11:00 ET): initial.
- v1.1 (2026-11-07 11:50 ET), additive: `Citation.span_start/span_end`, `IntakeResult.reason`, whatif filters, `max_items` on gaps, `POST /api/reset`, and `source_authority: "private"` for pasted transcripts.
- v1.2 (2026-11-07 17:55 ET), additive: `DELETE /api/intake/{item_id}` to undo one pasted transcript (`IntakeUndoResult`), and CORS allows DELETE.
