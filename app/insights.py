"""Insight cards (contract section 5).

Two kinds of card, both built only from verified quotes:

1. Item cards: one per evidence item with actionable == "yes" that has at
   least one verified aspect span. An actionable item with no quotable span
   gets no card, because a card must cite its claim.
2. Shift cards: a week-over-week change in one (product, aspect, speaker)
   series, including speaker "all". The current week cell needs n_items >= 2,
   the previous non-empty week of the same series must lie within
   SHIFT_LOOKBACK_WEEKS and also have n_items >= 2, and the mean must move by
   at least 1 point. A per-speaker shift whose items are identical to the
   all-speaker shift for the same week is dropped as a duplicate.

Text fields are templates filled from item fields only (title, source,
published, product, aspect values). `fact` is what the source says,
`observed_sentiment` is the labeled polarity, and `interpretation` is the
templated reading. None of them makes a clinical claim.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Collection

from .evidence import annotate, score_level, strongest_authority, week_index
from .models import ASPECTS, Citation, Confidence, EvidenceItem, InsightCard, TrendCell
from .trends import ALL, compute_trends, included

SHIFT_MIN_DELTA = 1.0
SHIFT_MIN_ITEMS = 2
SHIFT_LOOKBACK_WEEKS = 4
MAX_SHIFT_CITATIONS = 8
HEADLINE_TITLE_CHARS = 110

PRODUCT_LABEL = {
    "A": "Tagrisso (A)",
    "B": "Rybrevant / Lazcluze (B)",
    "both": "Tagrisso and Rybrevant (both)",
}
SOURCE_LABEL = {
    "pubmed": "PubMed article",
    "ctgov": "ClinicalTrials.gov record",
    "fda_event": "FDA adverse-event report",
    "fda_label": "FDA label",
    "fda_notice": "FDA notice",
    "press_release": "Company press release",
    "news": "News item",
    "transcript": "Private transcript (local only)",
}
ASPECT_LABEL = {
    "efficacy": "Efficacy",
    "safety": "Safety",
    "convenience": "Convenience",
    "access_cost": "Access and cost",
    "evidence_quality": "Evidence quality",
}
SIGNAL_LABEL = {
    "efficacy": "Efficacy signal",
    "safety": "Safety signal",
    "regulatory": "Regulatory update",
    "trial_update": "Trial update",
    "competitor_move": "Competitor move",
    "access_pricing": "Access and pricing update",
    "guideline": "Guideline update",
    "expert_opinion": "Expert opinion",
    "none": "Flagged item",
}
WHY_IT_MATTERS = {
    "efficacy": "New efficacy evidence can change how the benefit is discussed. "
    "Medical affairs should check it against current messaging and medical-information responses.",
    "safety": "A safety finding can raise label, pharmacovigilance and medical-information "
    "questions. "
    "Route it to drug safety and medical information for review.",
    "regulatory": "A regulatory action can change what the label supports and where the "
    "product can be used. "
    "Review messaging, launch sequencing and medical-information content.",
    "trial_update": "A change in trial status or results moves the timing of future evidence. "
    "Update the evidence-generation and competitive timeline.",
    "competitor_move": "A competitor action can change positioning in the same patient population. "
    "Brief brand strategy and the field team.",
    "access_pricing": "A reimbursement, HTA or pricing decision affects patient access. "
    "Route it to market access for planning.",
    "guideline": "A guideline change can shift standard practice and prescribing choices. "
    "Review it with medical affairs and update field materials.",
    "expert_opinion": "An expert view shows how prescribers may be reading the evidence. "
    "Check whether other experts echo it before acting.",
    "none": "Labeled actionable without a specific signal type. "
    "Read the cited quotes to decide who owns it.",
}
LEVEL_RANK = {"high": 0, "medium": 1, "low": 2}
ORIGIN_LABEL = {
    "gold_dev": "organizer dev label",
    "predicted": "local pipeline prediction",
    "rule": "rule-derived label",
    "private_transcript": "local pipeline, private transcript",
    "synthetic_demo": "synthetic demo data",
}


def _truncate(s: str, n: int) -> str:
    s = " ".join(s.split())
    if len(s) <= n:
        return s
    cut = s[:n].rsplit(" ", 1)[0]
    return cut.rstrip(",;:.") + "..."


def _citation(e: EvidenceItem, aspect_name: str) -> Citation | None:
    for a in e.aspects:
        if a.aspect == aspect_name:
            return Citation(
                item_id=e.item_id,
                aspect=a.aspect,
                span=a.span,
                url=e.url,
                span_start=a.span_start,
                span_end=a.span_end,
            )
    return None


def _direction(polarities: list[int]) -> str:
    pos, neg = any(p > 0 for p in polarities), any(p < 0 for p in polarities)
    if pos and neg:
        return "mixed"
    if pos:
        return "positive"
    if neg:
        return "negative"
    return "neutral"


# ---- item cards ------------------------------------------------------------


def item_card(e: EvidenceItem) -> InsightCard | None:
    if e.actionable != "yes" or not e.aspects:
        return None
    citations = [
        Citation(
            item_id=e.item_id,
            aspect=a.aspect,
            span=a.span,
            url=e.url,
            span_start=a.span_start,
            span_end=a.span_end,
        )
        for a in e.aspects
    ]
    sentiment = "; ".join(
        f"{ASPECT_LABEL[a.aspect]} {a.polarity:+d} ({a.speaker})" for a in e.aspects
    )
    n = e.confidence.corroborating_items
    direction = _direction([a.polarity for a in e.aspects])
    return InsightCard(
        id=f"card-{e.item_id}",
        headline=f"{SIGNAL_LABEL[e.signal_type]} for {PRODUCT_LABEL[e.product]}: "
        f"{_truncate(e.title, HEADLINE_TITLE_CHARS)}",
        signal_type=e.signal_type,
        product=e.product,
        week=e.iso_week,
        actionable=True,
        why_it_matters=WHY_IT_MATTERS[e.signal_type],
        citations=citations,
        confidence=e.confidence,
        fact=f"{SOURCE_LABEL.get(e.source, e.source)} published {e.published} "
        f"(ISO week {e.iso_week}), "
        f'titled "{_truncate(e.title, 200)}".',
        observed_sentiment=f"{sentiment}. Scale -2 to +2, labeled by: {ORIGIN_LABEL[e.origin]}.",
        interpretation=f"Overall direction in this item is {direction}. "
        f"{n} other item(s) on the same product, aspect and direction appeared within 2 weeks.",
    )


# ---- shift cards -----------------------------------------------------------


def _shift_card(cur: TrendCell, prev: TrendCell, by_id: dict[str, EvidenceItem]) -> InsightCard:
    assert cur.mean_polarity is not None and prev.mean_polarity is not None
    delta = round(cur.mean_polarity - prev.mean_polarity, 3)
    items_now = [by_id[i] for i in cur.item_ids]
    items_before = [by_id[i] for i in prev.item_ids]
    citations: list[Citation] = []
    for e in items_now + items_before:
        c = _citation(e, cur.aspect)
        if c is not None and len(citations) < MAX_SHIFT_CITATIONS:
            citations.append(c)

    methods = {e.confidence.method for e in items_now + items_before}
    method = methods.pop() if len(methods) == 1 else "mixed"
    authority = strongest_authority(e.confidence.source_authority for e in items_now)
    agreeing = sum(
        1
        for e in items_now
        for a in e.aspects
        if a.aspect == cur.aspect and (a.polarity - prev.mean_polarity) * delta > 0
    )
    level, points = score_level(method, True, authority, agreeing)
    signal = Counter(e.signal_type for e in items_now).most_common(1)[0][0]
    who = "all speakers" if cur.speaker == ALL else f"{cur.speaker} voices"
    verb = "rose" if delta > 0 else "fell"
    aspect_lower = ASPECT_LABEL[cur.aspect].lower()
    return InsightCard(
        id=f"shift-{cur.product}-{cur.aspect}-{cur.speaker}-{cur.week}",
        headline=f"{ASPECT_LABEL[cur.aspect]} sentiment on {PRODUCT_LABEL[cur.product]} ({who}) "
        f"{verb} {abs(delta):.1f} points in {cur.week}",
        signal_type=signal,
        product=cur.product,
        week=cur.week,  # type: ignore[arg-type]
        actionable=any(e.actionable == "yes" for e in items_now),
        why_it_matters=f"A week-over-week move in {aspect_lower} sentiment shows where "
        f"the conversation is changing. Read the cited quotes before acting on it.",
        citations=citations,
        confidence=Confidence(
            level=level,
            method=method,
            span_verified=True,  # type: ignore[arg-type]
            source_authority=authority,
            corroborating_items=agreeing,  # type: ignore[arg-type]
            notes=[
                f"rubric: shift card over {cur.n_items} + {prev.n_items} items; "
                f"{agreeing} item(s) in {cur.week} moved in the shift direction; "
                f"{points} point(s)"
            ],
        ),
        fact=f"{cur.week}: mean {cur.mean_polarity:+.2f} over {cur.n_items} items "
        f"from {cur.n_sources} "
        f"source type(s). {prev.week}: mean {prev.mean_polarity:+.2f} over {prev.n_items} items.",
        observed_sentiment=f"Change of {delta:+.2f} on the -2 to +2 scale.",
        interpretation="A one-week move over a handful of items can come from a single "
        "publication or news "
        "cycle. Treat it as a prompt to read the cited quotes, with N shown above.",
    )


def shift_cards(evidence: list[EvidenceItem], excluded: Collection[str] = ()) -> list[InsightCard]:
    cells = compute_trends(evidence, excluded, aspects=ASPECTS)
    by_id = {e.item_id: e for e in included(evidence, excluded)}
    series: dict[tuple[str, str, str], list[TrendCell]] = {}
    for c in cells:
        if c.n_items:
            series.setdefault((c.product, c.aspect, c.speaker), []).append(c)

    cards: list[InsightCard] = []
    all_speaker_sets: set[tuple[str, str, str, frozenset[str]]] = set()
    for (product, aspect, speaker), seq in sorted(series.items(), key=lambda kv: kv[0][2] != ALL):
        seq.sort(key=lambda c: week_index(c.week))
        for prev, cur in zip(seq, seq[1:], strict=False):
            if week_index(cur.week) - week_index(prev.week) > SHIFT_LOOKBACK_WEEKS:
                continue
            if cur.n_items < SHIFT_MIN_ITEMS or prev.n_items < SHIFT_MIN_ITEMS:
                continue
            assert cur.mean_polarity is not None and prev.mean_polarity is not None
            if abs(cur.mean_polarity - prev.mean_polarity) < SHIFT_MIN_DELTA:
                continue
            sig = (product, aspect, cur.week, frozenset(cur.item_ids))
            if speaker == ALL:
                all_speaker_sets.add(sig)
            elif sig in all_speaker_sets:
                continue
            cards.append(_shift_card(cur, prev, by_id))
    return cards


# ---- all cards -------------------------------------------------------------


def build_insights(
    evidence: list[EvidenceItem],
    excluded: Collection[str] = (),
    *,
    products: Collection[str] | None = None,
) -> list[InsightCard]:
    """Every card for `evidence` minus `excluded`. Confidence is recomputed on the included set."""
    kept = annotate(included(evidence, excluded))
    cards = [c for e in kept if (c := item_card(e)) is not None]
    cards += shift_cards(kept)
    if products is not None:
        cards = [c for c in cards if c.product in products]
    cards.sort(key=lambda c: (-week_index(c.week), LEVEL_RANK[c.confidence.level], c.id))
    return cards
