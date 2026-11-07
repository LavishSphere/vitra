"""Prompt construction: a compact digest of the organizer LABELING_GUIDE, few-shot examples
chosen by source from a labeled pool, and the strict JSON schema for the model output.

The model only decides what the rules can't: signal_type and actionable for pubmed /
press_release / news, the aspects with polarity and span, and the speaker for news.
"""

from __future__ import annotations

import json
import math
import os
import re
from collections import Counter
from collections.abc import Sequence
from typing import Any

from .schema import ASPECTS, POLARITIES, SIGNAL_TYPES, SPEAKERS
from .spans import sentence_bounds

PROMPT_VERSION = "p2"

MAX_ITEM_CHARS = 5000
MAX_EXAMPLE_CHARS = 1400
N_FEWSHOT = 3
# A pasted transcript pays the example cost on every call. Scored sources stay at N_FEWSHOT.
N_FEWSHOT_TRANSCRIPT = 1

_P1_SYSTEM = [
    "You label public evidence about two lung cancer drugs for a pharma launch team.",
    "Products: A = Tagrisso (osimertinib). B = Rybrevant / Rybrevant Faspro (amivantamab)"
    " and Lazcluze (lazertinib). Setting: EGFR-mutated NSCLC.",
    "Label only what the TEXT says about OUR products (A or B). Return JSON only.",
    "",
    "signal_type = the MAIN thing the item reports:",
    "- efficacy: outcome or effectiveness data for our product (also lab/preclinical studies,"
    " and our own trial results even vs the other product)",
    "- safety: side effects, adverse events, warnings, toxicity management",
    "- regulatory: approvals, label changes, filings, designations",
    "- trial_update: trial registrations or status, or a publication describing a trial"
    " design/protocol",
    "- competitor_move: item led by a rival drug or third party that beats or challenges our"
    " product; company earnings releases",
    "- access_pricing: coverage, reimbursement, price, HTA cost decisions",
    "- guideline: guideline or pathway changes",
    "- expert_opinion: commentary, narrative reviews, expert views with no new data",
    "- none: nothing new about our products (passing mention, unrelated drug, explainer,"
    " pure data table)",
    "",
    'actionable = "yes" only if a launch team would plausibly change a plan or message:'
    " new pivotal/phase 3 data, new indications or label changes, guideline changes,"
    ' competitor moves, reimbursement decisions. "no" for case reports, small or'
    " retrospective studies, lab studies, reviews, repeats of known data.",
    "",
    "Aspects: fill one ONLY when the text JUDGES our product on it, else null."
    " Most items judge 0 to 2 aspects.",
    '- efficacy: does it work (PFS, OS, response, "did not meet endpoint", resistance)',
    '- safety: side effects or tolerability (rash, ILD, grade >=3 AEs, VTE, "well tolerated")',
    "- convenience: dosing, administration, burden (oral once daily, infusion time,"
    " subcutaneous, premedication)",
    "- access_cost: coverage, price, reimbursement, cost-effectiveness, availability",
    "- evidence_quality: strength of evidence (randomized phase 3 = +1 only if stressed;"
    " retrospective, small sample, immature data, further studies needed = -1)",
    "polarity: -2 strongly negative (failed, fatal, boxed warning) | -1 mildly negative"
    " (a concern, more frequent, limited by, resistance) | 0 neutral or mixed | +1 mildly"
    " positive (encouraging, manageable, improved) | +2 strongly positive (significantly"
    " prolonged, statistically significant and clinically meaningful, practice-changing).",
    'Anchors: "no new safety signals" or "consistent with the known safety profile" ='
    ' safety 0. "manageable" or "well tolerated" = safety +1. A rival beating osimertinib'
    " = osimertinib efficacy -1. When unsure between two levels, pick the one closer to 0.",
    "span: the SHORTEST phrase (3 to 15 words) copied character for character from ONE"
    " sentence of the text that justifies the aspect and its polarity. Never paraphrase,"
    " never join sentences.",
]

# p2: targets p1 dev errors (actionable over-predicted, long numeric spans, aspects on
# passing mentions). Same structure otherwise.
_P2_EXTRA = [
    "",
    "Calibration:",
    '- About 4 in 5 items are actionable "no". Say "yes" only for practice-changing news:'
    " a positive or negative phase 3 readout, an approval or label change, a guideline"
    " change, a reimbursement decision, or a rival clearly beating our product.",
    "- If our product is only the background, a comparator mentioned in passing, or the"
    " study is about another drug, biomarker or prognosis: signal none (or efficacy for lab"
    " work) and leave every aspect null.",
    "- Leave an aspect null rather than guess. Do not fill convenience, access_cost or"
    " evidence_quality unless the text clearly talks about them.",
    "- A span quotes the judging words themselves (for example 'significantly improved"
    " progression-free survival', 'a manageable safety profile', 'retrospective cohort"
    " study'), not bare numbers, hazard ratios or p-values.",
]

_NEWS_SPEAKER = [
    "",
    "speaker (news only): who holds the opinion in the span: hcp (a clinician), payer,"
    " company, regulator (FDA, EMA, NICE, HAS), patient, researcher; the writer's own"
    " framing or headline = media.",
]

SOURCE_HINTS = {
    "pubmed": "Source: a PubMed abstract. Speaker is always the researchers. Authors' caveats"
    " (retrospective, small sample, further studies needed) = evidence_quality -1."
    " Case reports: actionable no. Trial design/protocol papers = trial_update.",
    "press_release": "Source: a company press release. The company is positive about its own"
    " product: label what it says. A release about a rival's win is competitor_move for our"
    " product.",
    "news": "Source: a news headline and snippet. If the article is mainly about a different"
    " drug and ours is only the comparator, use competitor_move (if it beats or challenges"
    " ours) or none.",
    "transcript": "Source: a private transcript of experts discussing our products. Label each"
    " speaker's view in the matching aspect.",
}

SYSTEMS = {
    "p1": "\n".join(_P1_SYSTEM),
    "p2": "\n".join(_P1_SYSTEM + _P2_EXTRA),
}
NEWS_SPEAKER = "\n".join(_NEWS_SPEAKER)


def system_prompt(version: str, source: str, no_think: bool = False) -> str:
    with_speaker = source in ("news", "transcript")
    text = ("/no_think\n" if no_think else "") + SYSTEMS[version]
    if with_speaker:
        text += NEWS_SPEAKER
    return text + "\n\n" + SOURCE_HINTS.get(source, "")


def _aspect_schema(with_speaker: bool) -> dict[str, Any]:
    props: dict[str, Any] = {
        "span": {"type": "string", "minLength": 3, "maxLength": 220},
        "polarity": {"type": "integer", "enum": list(POLARITIES)},
    }
    if with_speaker:
        props["speaker"] = {"type": "string", "enum": list(SPEAKERS)}
    return {
        "anyOf": [
            {"type": "null"},
            {
                "type": "object",
                "properties": props,
                "required": list(props),
                "additionalProperties": False,
            },
        ]
    }


def output_schema(source: str) -> dict[str, Any]:
    with_speaker = source in ("news", "transcript")
    props: dict[str, Any] = {
        "signal_type": {"type": "string", "enum": list(SIGNAL_TYPES)},
        "actionable": {"type": "string", "enum": ["yes", "no"]},
    }
    for a in ASPECTS:
        props[a] = _aspect_schema(with_speaker)
    return {
        "type": "object",
        "properties": props,
        "required": list(props),
        "additionalProperties": False,
    }


def excerpt(text: str, keep_spans: Sequence[str], limit: int) -> str:
    """Shorten `text` to about `limit` chars, keeping the sentences that hold `keep_spans`."""
    if len(text) <= limit:
        return text
    bounds = sentence_bounds(text)
    must = {
        i for i, (s, e) in enumerate(bounds) if any(sp and sp in text[s:e] for sp in keep_spans)
    }
    keep: set[int] = set(must)
    budget = limit - sum(bounds[i][1] - bounds[i][0] for i in must)
    for i, (s, e) in enumerate(bounds):
        if i in keep:
            continue
        if budget - (e - s) < 0:
            break
        keep.add(i)
        budget -= e - s
    parts: list[str] = []
    prev = -1
    for i in sorted(keep):
        if prev >= 0 and i != prev + 1:
            parts.append("[...]")
        s, e = bounds[i]
        parts.append(text[s:e])
        prev = i
    return " ".join(parts)


def item_text_for_prompt(item: dict[str, Any]) -> str:
    text = item.get("text") or ""
    return text[:MAX_ITEM_CHARS]


def user_message(item: dict[str, Any], text: str | None = None) -> str:
    return (
        f"source: {item.get('source')} | product: {item.get('product')}"
        f" | published: {item.get('published')}\n"
        f"title: {item.get('title') or ''}\n"
        f"text: {item_text_for_prompt(item) if text is None else text}"
    )


def gold_to_output(gold: dict[str, Any], with_speaker: bool) -> dict[str, Any]:
    out: dict[str, Any] = {"signal_type": gold["signal_type"], "actionable": gold["actionable"]}
    for a in ASPECTS:
        g = gold.get(a)
        if g:
            out[a] = {"span": g["span"], "polarity": g["polarity"]}
            if with_speaker:
                out[a]["speaker"] = g["speaker"]
        else:
            out[a] = None
    return out


_WORD = re.compile(r"[a-z0-9]{3,}")
_EXAMPLE_SOURCES = {
    "pubmed": ("pubmed",),
    "press_release": ("press_release", "news"),
    "news": ("news", "press_release"),
    "transcript": ("news", "press_release", "pubmed"),
}


SIMILARITY_CHARS = 600
FEWSHOT_METHODS = ("tfidf", "tfidf-mixed", "jaccard")


def _head(item: dict[str, Any]) -> str:
    return f"{item.get('title') or ''} {(item.get('text') or '')[:SIMILARITY_CHARS]}".lower()


def _words(item: dict[str, Any]) -> set[str]:
    return set(_WORD.findall(_head(item)))


def tfidf_similarity(query: dict[str, Any], docs: Sequence[dict[str, Any]]) -> dict[str, float]:
    """Cosine similarity of `query` to each doc (keyed by item_id) on title + text head.

    Sublinear tf and smoothed idf fitted on the docs plus the query. Standard library only.
    """
    tfs = {d["item_id"]: Counter(_WORD.findall(_head(d))) for d in docs}
    q_tf = Counter(_WORD.findall(_head(query)))
    n = len(tfs) + 1
    df: Counter[str] = Counter()
    for tf in [*tfs.values(), q_tf]:
        df.update(tf.keys())
    idf = {w: math.log((n + 1) / (c + 1)) + 1.0 for w, c in df.items()}

    def unit(tf: Counter[str]) -> dict[str, float]:
        v = {w: (1.0 + math.log(c)) * idf[w] for w, c in tf.items()}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        return {w: x / norm for w, x in v.items()}

    q = unit(q_tf)
    return {iid: sum(x * q.get(w, 0.0) for w, x in unit(tf).items()) for iid, tf in tfs.items()}


def jaccard_similarity(query: dict[str, Any], docs: Sequence[dict[str, Any]]) -> dict[str, float]:
    """Word-set overlap of `query` with each doc (keyed by item_id)."""
    w = _words(query)
    return {d["item_id"]: len(w & _words(d)) / (len(w | _words(d)) or 1) for d in docs}


def fewshot_method() -> str:
    """Example ranking: 'tfidf' (same source first, then cosine) or 'jaccard' (overlap first)."""
    m = os.environ.get("VITRA_FEWSHOT_METHOD", "tfidf")
    return m if m in FEWSHOT_METHODS else "tfidf"


def fewshot_k(source: str | None) -> int:
    """How many labeled examples to place before this item."""
    if source == "transcript":
        return N_FEWSHOT_TRANSCRIPT
    return N_FEWSHOT


def select_fewshot(
    item: dict[str, Any],
    pool: Sequence[dict[str, Any]],
    k: int = N_FEWSHOT,
    method: str | None = None,
) -> list[dict[str, Any]]:
    """Most similar labeled examples of a compatible source, at most 2 per signal type.

    'tfidf' ranks the item's own source first, then TF-IDF cosine; 'jaccard' ranks by
    word-set overlap and uses source only to break ties. Deterministic (final tie-break on
    item_id). The item itself is always skipped; in evaluation the caller removes its fold.
    """
    method = method or fewshot_method()
    srcs = _EXAMPLE_SOURCES.get(item.get("source") or "", ("pubmed",))
    cands = [
        p
        for p in pool
        if p.get("source") in srcs and p.get("text") and p["item_id"] != item.get("item_id")
    ]
    sim = (jaccard_similarity if method == "jaccard" else tfidf_similarity)(item, cands)

    def score(p: dict[str, Any]) -> tuple[float, float, str]:
        src_rank = float(srcs.index(p["source"]))
        s = -round(sim[p["item_id"]], 12)
        return (src_rank, s, p["item_id"]) if method == "tfidf" else (s, src_rank, p["item_id"])

    chosen: list[dict[str, Any]] = []
    per_signal: dict[str, int] = {}
    for p in sorted(cands, key=score):
        if per_signal.get(p["signal_type"], 0) >= 2:
            continue
        chosen.append(p)
        per_signal[p["signal_type"]] = per_signal.get(p["signal_type"], 0) + 1
        if len(chosen) == k:
            break
    return chosen


def build_messages(
    item: dict[str, Any],
    pool: Sequence[dict[str, Any]] | None,
    *,
    no_think: bool = False,
    version: str = PROMPT_VERSION,
) -> list[dict[str, str]]:
    source = item.get("source") or "news"
    with_speaker = source in ("news", "transcript")
    system = system_prompt(version, source, no_think)
    msgs: list[dict[str, str]] = [{"role": "system", "content": system}]
    # examples are presented most-similar-last (closest to the query)
    for ex in reversed(select_fewshot(item, pool or [], fewshot_k(source))):
        spans = [ex[a]["span"] for a in ASPECTS if ex.get(a)]
        ex_text = excerpt(ex["text"], spans, MAX_EXAMPLE_CHARS)
        msgs.append({"role": "user", "content": user_message(ex, ex_text)})
        msgs.append(
            {
                "role": "assistant",
                "content": json.dumps(gold_to_output(ex, with_speaker), ensure_ascii=False),
            }
        )
    msgs.append({"role": "user", "content": user_message(item)})
    return msgs
