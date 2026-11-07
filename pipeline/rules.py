"""Deterministic labels from the organizer LABELING_GUIDE.

ctgov, fda_event, fda_label and fda_notice are decided here completely. For pubmed,
press_release and news this module gives (a) speaker-by-source, (b) hard overrides the
guide makes explicit (earnings releases, case reports, lab studies, protocols) and
(c) a keyword fallback used when the model is off or fails.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any

from .schema import ASPECTS, aspect, empty_prediction
from .spans import sentence_bounds

RULES_VERSION = "r5"

MODEL_SOURCES = frozenset({"pubmed", "press_release", "news", "transcript"})
# sources where the model names the speaker (the quoted voice); others are fixed by source
FREE_SPEAKER_SOURCES = frozenset({"news", "transcript"})

SOURCE_SPEAKER = {
    "pubmed": "researcher",
    "ctgov": "company",
    "fda_label": "regulator",
    "fda_notice": "regulator",
    "press_release": "company",
    "news": "media",
    "transcript": "hcp",  # private advisory-board style transcripts; model may pick another voice
}

OUR_PRODUCTS = re.compile(
    r"(?i)\b(tagrisso|osimertinib|azd9291|rybrevant|amivantamab|lazcluze|lazertinib)\b"
)


@dataclass
class RuleResult:
    prediction: dict[str, Any]
    final: bool  # True: no model call needed
    notes: list[str] = field(default_factory=list)
    hard: dict[str, Any] = field(default_factory=dict)  # fields the model may not override
    lab_study: bool = False


# --------------------------------------------------------------------------- helpers


def phrase_around(text: str, match: re.Match[str], max_words: int = 12) -> str:
    """Shortest natural phrase around a regex match: its clause, capped at `max_words`.

    The result is an exact substring of `text` inside one sentence.
    """
    ms, me = match.start(), match.end()
    s0, e0 = 0, len(text)
    for a, b in sentence_bounds(text):
        if a <= ms < b:
            s0, e0 = a, max(b, min(me, b))
            break
    # clause = between , ; : ( ) inside the sentence
    left = max(text.rfind(c, s0, ms) for c in ",;:()")
    cs = left + 1 if left >= s0 else s0
    rights = [i for i in (text.find(c, me, e0) for c in ",;:()") if i >= 0]
    ce = min(rights) if rights else e0
    words = list(re.finditer(r"\S+", text[cs:ce]))
    if len(words) > max_words:
        # keep the match, plus up to 3 words before it
        idx = next((i for i, w in enumerate(words) if cs + w.end() > ms), 0)
        lo = max(0, idx - 3)
        hi = min(len(words), lo + max_words)
        lo = max(0, min(lo, hi - max_words))
        cs, ce = cs + words[lo].start(), cs + words[hi - 1].end()
    out = text[cs:ce].strip().rstrip(".,;:")
    # strip whitespace offsets back to an exact slice
    start = text.find(out, cs)
    return text[start : start + len(out)] if start >= 0 and out else match.group(0)


def _first(pattern: str, text: str, flags: int = re.I) -> re.Match[str] | None:
    return re.search(pattern, text, flags)


def _negated(text: str, pos: int) -> bool:
    return bool(
        re.search(
            r"(?i)\b(not|no|isn't|without|unrelated|n't)\b[^.]{0,40}$", text[max(0, pos - 45) : pos]
        )
    )


# --------------------------------------------------------------------------- ctgov

_CT_EFFICACY = (
    r"futility|insufficient (?:efficacy|activity|benefit)|lack of (?:efficacy|benefit|activity)"
    r"|did not meet|ineffective|no clinical benefit"
)
_CT_SAFETY = r"toxicit|safety concern|adverse event|unacceptable|side effect"


def ctgov_rules(item: dict[str, Any]) -> RuleResult:
    text = item.get("text") or ""
    pred = empty_prediction(item["item_id"])
    pred["signal_type"] = "trial_update"
    status = (_first(r"Status(?: as of last update \([^)]*\))?: ([A-Z_]+)", text, 0) or [None, ""])[
        1
    ]
    phase = text.split(" · ")[1] if " · " in text else ""
    new_reg = "New registration" in text
    stopped = status in {"TERMINATED", "WITHDRAWN", "SUSPENDED"}
    notes = [f"status={status}", f"phase={phase}", f"new_registration={new_reg}"]
    if stopped or (new_reg and "PHASE3" in phase):
        pred["actionable"] = "yes"
    reason_m = _first(r'Reason given: "([^"]*)"', text)
    if reason_m:
        reason = reason_m.group(1)
        base = reason_m.start(1)
        for asp, pat in (("efficacy", _CT_EFFICACY), ("safety", _CT_SAFETY)):
            m = re.search(pat, reason, re.I)
            if m and not _negated(reason, m.start()):
                anchor = re.compile(re.escape(m.group(0))).search(text, base + m.start())
                if anchor is not None:
                    pred[asp] = aspect(-2, "company", phrase_around(text, anchor, 10))
                notes.append(f"stop reason judges {asp}")
    return RuleResult(pred, final=True, notes=notes)


# --------------------------------------------------------------------------- fda_event

_EVT_NO_ASPECT = re.compile(
    r"(?i)^(off label use|product use issue|intentional product use issue|no adverse event|"
    r"product use in unapproved indication|inappropriate schedule of product administration|"
    r"product dose omission(?: issue| in error)?|medication error|"
    r"product administration (?:error|interrupted)|"
    r"incorrect (?:dose|route of product) administ\w*|wrong technique in product usage process|"
    r"product packaging quantity issue|product preparation issue|intentional product misuse|"
    r"therapy cessation|therapy interrupted|treatment noncompliance|underdose|overdose|"
    r"therapeutic product effect increased|drug interaction|exposure during pregnancy)$"
)
_EVT_EFFICACY = re.compile(
    r"(?i)^(drug ineffective|disease progression|malignant neoplasm progression|"
    r"therapeutic product effect decreased|drug resistance|treatment failure|"
    r"therapy non-responder)$"
)
_EVT_ACCESS = re.compile(
    r"(?i)^(inability to afford medication|product unavailable|product supply issue)$"
)


def _reporter_speaker(text: str) -> str:
    m = re.search(r"Reporter: ([^.]*)", text)
    who = m.group(1).strip().lower() if m else ""
    if who in {"physician", "pharmacist", "other health professional"} or "health" in who:
        return "hcp"
    return "patient"  # consumer (and the rare 'unknown')


def fda_event_rules(item: dict[str, Any]) -> RuleResult:
    text = item.get("text") or ""
    pred = empty_prediction(item["item_id"])
    pred["signal_type"] = "safety"
    speaker = _reporter_speaker(text)
    m = re.search(r"Reactions: (.*?)\. Serious", text)
    if not m:
        return RuleResult(pred, final=True, notes=["reactions not parsed"])
    start = m.start(1)
    reactions: list[tuple[int, int, str]] = []
    pos = start
    for r in m.group(1).split(", "):
        reactions.append((pos, pos + len(r), r))
        pos += len(r) + 2
    kinds = [
        "skip"
        if _EVT_NO_ASPECT.match(r)
        else "eff"
        if _EVT_EFFICACY.match(r)
        else "acc"
        if _EVT_ACCESS.match(r)
        else "safe"
        for _, _, r in reactions
    ]
    # safety span: first contiguous run of ordinary reactions, as written
    run: list[int] = []
    for i, k in enumerate(kinds):
        if k == "safe":
            run.append(i)
        elif run:
            break
    if run:
        s, e = reactions[run[0]][0], reactions[run[-1]][1]
        pred["safety"] = aspect(-1, speaker, text[s:e])
    for asp, kind in (("efficacy", "eff"), ("access_cost", "acc")):
        if kind in kinds:
            s, e, _ = reactions[kinds.index(kind)]
            pred[asp] = aspect(-1, speaker, text[s:e])
    return RuleResult(pred, final=True, notes=[f"reporter->{speaker}", f"kinds={kinds}"])


# --------------------------------------------------------------------------- fda_label

_LABEL_RE = re.compile(
    r"^(?P<prod>.+?) label, section (?P<section>.+?), updated on (?P<date>[\d-]+)\. "
    r"New text: (?P<new>.*?)(?: Removed text: (?P<removed>.*))?$",
    re.S,
)


def _label_trivial(new: str, removed: str | None) -> bool:
    """True when the new text only re-states the removed text (table rows, renumbering)."""
    if not removed:
        return False
    a, b = new.rstrip("…").strip(), removed.rstrip("…").strip()
    n = min(len(a), len(b))
    if n == 0:
        return False
    return SequenceMatcher(None, a[:n], b[:n], autojunk=False).ratio() >= 0.8


def fda_label_rules(item: dict[str, Any]) -> RuleResult:
    text = item.get("text") or ""
    pred = empty_prediction(item["item_id"])
    m = _LABEL_RE.match(text)
    if not m:
        pred["signal_type"] = "regulatory"
        return RuleResult(pred, final=True, notes=["label text not parsed"])
    section = m.group("section").lower()
    new, removed = m.group("new"), m.group("removed")
    new_off = m.start("new")
    notes = [f"section={section}"]
    if _label_trivial(new, removed) or re.match(
        r"(?i)\s*(select )?laboratory abnormalities|table \d", new
    ):
        notes.append("no clinical meaning")
        return RuleResult(pred, final=True, notes=notes)

    region = text[new_off : m.end("new")]

    def find(pattern: str) -> re.Match[str] | None:
        return re.compile(pattern, re.I).search(text, new_off, new_off + len(region))

    pred["signal_type"] = "regulatory"
    pred["actionable"] = "yes"
    if "boxed" in section:
        hit = find(r"\S.{0,80}")
        if hit:
            pred["safety"] = aspect(-2, "regulator", phrase_around(text, hit))
    elif "indication" in section:
        hit = find(r"indicated (?:for|in)|in combination with|for the (?:first-line )?treatment")
        if hit:
            pred["efficacy"] = aspect(1, "regulator", phrase_around(text, hit))
    elif "warning" in section:
        hit = find(r"monitor|withhold|discontinue|advise patients|risk of|recommended to reduce")
        if hit:
            pred["safety"] = aspect(-1, "regulator", phrase_around(text, hit))
    elif "dosage" in section:
        conv = find(
            r"may switch to an? every \d-week dosing regimen|every \d-week|subcutaneous|switch"
        )
        burden = find(r"premedicat|prophyla|concomitant medication|anticoagulant")
        stop = find(r"permanently discontinue|withhold|discontinue")
        if conv:
            pred["convenience"] = aspect(1, "regulator", phrase_around(text, conv))
        elif burden:
            pred["convenience"] = aspect(-1, "regulator", phrase_around(text, burden))
        if stop and not conv:
            pred["safety"] = aspect(-1, "regulator", phrase_around(text, stop))
    elif "adverse" in section:
        pred["actionable"] = "no"
    else:
        pred["actionable"] = "no"
    return RuleResult(pred, final=True, notes=notes)


# --------------------------------------------------------------------------- fda_notice


def fda_notice_rules(item: dict[str, Any]) -> RuleResult:
    text = item.get("text") or ""
    pred = empty_prediction(item["item_id"])
    pred["signal_type"] = "regulatory"
    pred["actionable"] = "yes"
    approval = _first(r"approv\w*", text)
    new_schedule = _first(
        r"subcutaneous|every \d[- ]week|new (?:dosing|formulation|schedule)|"
        r"formulation|administration time|injection",
        text,
    )
    if approval and new_schedule:
        span = phrase_around(text, approval)
        pred["efficacy"] = aspect(0, "regulator", span)
        pred["safety"] = aspect(0, "regulator", span)
        pred["convenience"] = aspect(1, "regulator", phrase_around(text, new_schedule))
    elif approval:
        pred["efficacy"] = aspect(1, "regulator", phrase_around(text, approval))
    return RuleResult(pred, final=True, notes=["approval" if approval else "no approval wording"])


# --------------------------------------------------------------------------- model sources

_EARNINGS = re.compile(
    r"(?i)\b(reports? (?:q[1-4]|first|second|third|fourth|full)[- ]?(?:quarter|year)?|"
    r"(?:q[1-4]|quarter|full[- ]year|half[- ]year|h1|fy) ?20\d\d results|"
    r"(?:quarterly|annual) results|earnings)\b"
)
_CASE_REPORT = re.compile(
    r"(?i)\bcase report|\ba case of\b|\bcase series\b|\bwe report (?:a|an|two|three)\b"
    r"|\bwe present (?:a|an)\b"
)
_LAB = re.compile(
    r"(?i)\b(cell lines?|xenograft|in vitro|in vivo|mice|murine|organoids?|preclinical|knockdown|"
    r"pdx|cultured cells)\b"
)
_PROTOCOL = re.compile(
    r"(?i)\b(study protocol|protocol for|trial design|rationale and design|design and rationale|"
    r"trial in progress)\b"
)
_SAFETY_TITLE = re.compile(
    r"(?i)safety|adverse|toxicit|dermatolog|thromboemb|pneumonitis|interstitial lung|"
    r"\bild\b|rash|cardiotox|-induced|induced|management of|pharmacovigilance|faers"
)
_GUIDELINE = re.compile(
    r"(?i)guideline|nccn|esmo (?:living )?guideline|asco (?:updates|guideline)|pathway"
)
_APPROVAL = re.compile(
    r"(?i)\b(fda|ema|chmp|mhra|pmda|nmpa)\b.*\b(approv|authori[sz]|accept|grant)|approv(al|es|ed)\b"
)
_ACCESS = re.compile(
    r"(?i)\bpbs\b|reimburs|\bnice\b|\bhas\b|coverage|price|pricing|cost-effective|formulary|"
    r"payer|access to"
)


_PIVOTAL_TITLE = re.compile(r"(?i)\bphase (?:3|iii)\b|\brandomi[sz]ed\b")
_GUIDELINE_TITLE = re.compile(r"(?i)guideline|consensus|clinical opinion|recommendations?\b")


def _model_source_fallback(item: dict[str, Any]) -> dict[str, Any]:
    """Keyword fallback for pubmed / press_release / news (no aspects)."""
    source = item.get("source")
    title = item.get("title") or ""
    text = item.get("text") or ""
    pred = empty_prediction(item["item_id"])
    head = f"{title} {text[:600]}"
    if source == "pubmed":
        if _PROTOCOL.search(head):
            pred["signal_type"] = "trial_update"
        elif _SAFETY_TITLE.search(title):
            pred["signal_type"] = "safety"
        elif OUR_PRODUCTS.search(head):
            pred["signal_type"] = "efficacy"
        else:
            pred["signal_type"] = "none"
        # guide: new pivotal data and guideline changes are usually actionable
        if _PIVOTAL_TITLE.search(title) or _GUIDELINE_TITLE.search(title):
            pred["actionable"] = "yes"
        return pred
    if _GUIDELINE.search(title):
        pred["signal_type"], pred["actionable"] = "guideline", "yes"
    elif _ACCESS.search(title):
        pred["signal_type"], pred["actionable"] = "access_pricing", "yes"
    elif _APPROVAL.search(title):
        pred["signal_type"], pred["actionable"] = "regulatory", "yes"
    elif OUR_PRODUCTS.search(title):
        pred["signal_type"] = "efficacy"
        pred["actionable"] = "yes" if source == "press_release" else "no"
    return pred


def model_source_rules(item: dict[str, Any]) -> RuleResult:
    source = item.get("source")
    title = item.get("title") or ""
    text = item.get("text") or ""
    pred = _model_source_fallback(item)
    hard: dict[str, Any] = {}
    notes: list[str] = []
    if source == "press_release" and _EARNINGS.search(title):
        # ruling 5: earnings releases naming our products
        pred = empty_prediction(item["item_id"])
        pred["signal_type"] = "competitor_move"
        return RuleResult(pred, final=True, notes=["earnings release (ruling 5)"])
    lab_study = False
    if source == "pubmed":
        if _PROTOCOL.search(f"{title} {text[:400]}"):
            hard["signal_type"] = "trial_update"  # ruling 4
            notes.append("protocol/design (ruling 4)")
        if _CASE_REPORT.search(f"{title} {text[:400]}"):
            hard["actionable"] = "no"
            notes.append("case report")
        if _LAB.search(f"{title} {text}") and not re.search(r"(?i)\bpatients?\b", title):
            hard["signal_type"] = "efficacy"  # ruling 2
            hard["actionable"] = "no"
            notes.append("lab/preclinical (ruling 2)")
            lab_study = True
    for k, v in hard.items():
        pred[k] = v
    if source == "pubmed" and not lab_study:
        caveat = evidence_caveat(text)
        if caveat is not None:
            pred["evidence_quality"] = aspect(caveat[0], speaker_for(item), caveat[1])
            notes.append(f"evidence judged: {caveat[1]!r}")
        judged = efficacy_cue(text)
        if judged is not None:
            pred["efficacy"] = aspect(judged[0], speaker_for(item), judged[1])
            notes.append(f"efficacy judged: {judged[1]!r}")
        tolerated = safety_anchor(text)
        if tolerated is not None:
            pred["safety"] = aspect(tolerated[0], speaker_for(item), tolerated[1])
            notes.append(f"safety anchor: {tolerated[1]!r}")
    return RuleResult(pred, final=False, notes=notes, hard=hard, lab_study=lab_study)


# --------------------------------------------------------------------------- evidence quality
# Guide, pubmed: author caveats ("retrospective", "small sample", "further studies needed")
# = evidence_quality -1; a randomized phase 3 is +1 only when the text stresses design
# strength. Each pattern matches the shortest phrase that carries the judgment. Order is
# priority: study design, then limits on the results, then calls for more work.

_CAVEAT_PHRASES = tuple(
    re.compile(p, re.I)
    for p in (
        r"\bretrospective(?:,? (?:multi-?cent(?:er|re)|single[- ]cent(?:er|re)|observational"
        r"|real-world|cohort|chart|case-control|database|claims))*"
        r" (?:cohort study|study|analysis|review|cohort|design)\b",
        r"\bretrospectively (?:analy[sz]ed|reviewed|collected|evaluated|identified|assessed"
        r"|included|enrolled)\b",
        r"\bsingle[- ](?:cent(?:er|re)|institution(?:al)?)(?: (?:retrospective|observational))?"
        r" (?:study|analysis|cohort|experience|series)\b",
        r"\b(?:small|limited) (?:sample size|sample|number of (?:patients|cases)|cohort size)\b",
        r"\b(?:(?:possibly|likely|probably) )?(?:due to |because of |given )?(?:the )?immature"
        r" (?:data|os|overall survival(?: data)?|survival data|follow-up)\b",
        r"\b(?:was|were|is|are) limited by (?:the |its |a |their )?(?:small|short|retrospective"
        r"|limited|lack|sample|single|selection|heterogeneity)\w*(?: \w+){0,2}",
        r"\bshould be interpreted with caution\b",
        r"\blonger follow-up (?:is |are |will be )?(?:needed|required|warranted|necessary)\b",
        r"\bfurther (?:(?:prospective|large[- ]scale|larger|randomi[sz]ed|well-designed) )*"
        r"(?:studies|trials|research|investigation|validation)(?: (?:is|are))?"
        r" (?:needed|required|warranted|necessary)\b",
        r"\bwarrant(?:s|ing)? further (?:investigation|study|studies|research|validation)\b",
    )
)
# Cues whose judgment needs the surrounding clause ("X precluded a meaningful assessment").
_CAVEAT_CLAUSE = re.compile(
    r"(?i)\bprecluded\b|\bprevented (?:them |us |the authors )?(?:from )?demonstrating\b"
)
_DESIGN_STRENGTH = re.compile(
    r"(?i)\b(?:high[- ]quality|robust|strong|level (?:1|I)) evidence\b|\bwell[- ]designed"
    r" (?:randomi[sz]ed|phase (?:3|III))\b|\bmethodologically rigorous\b"
)
_PRIOR_WORK = re.compile(r"(?i)\b(?:previous|prior|earlier|existing|past)\b[^.;]{0,40}$")
_NEAR_NEGATION = re.compile(r"(?i)\b(?:not|no|non|without)[- ](?:\w+ )?$")


def _own_caveat(text: str, m: re.Match[str]) -> bool:
    """False when the cue is negated right before it or describes earlier studies."""
    head = text[max(0, m.start() - 60) : m.start()]
    return not _NEAR_NEGATION.search(head) and not _PRIOR_WORK.search(head)


def evidence_caveat(text: str) -> tuple[int, str] | None:
    """(polarity, span) when the text judges its own evidence, else None.

    The span is an exact substring of `text` inside one sentence.
    """
    for pat in _CAVEAT_PHRASES:
        for m in pat.finditer(text):
            if _own_caveat(text, m):
                return -1, m.group(0)
    for m in _CAVEAT_CLAUSE.finditer(text):
        if _own_caveat(text, m):
            return -1, phrase_around(text, m, 12)
    m = _DESIGN_STRENGTH.search(text)
    if m and _own_caveat(text, m):
        return 1, m.group(0)
    return None


# --------------------------------------------------------------------------- efficacy
# Guide, efficacy: "prolonged PFS", "improved OS", "did not meet endpoint"; polarity +2 for
# "significantly prolonged", "statistically significant and clinically meaningful",
# "practice-changing"; -2 for "failed". Only a sentence that names our product (or an
# abbreviation the text defines for a regimen with our product) can judge it. The authors'
# conclusions are read first; background sections describe earlier work and are skipped.
# Order is priority.

_EFFICACY_CUES = tuple(
    (pol, re.compile(p, re.I))
    for pol, p in (
        (2, r"\bsignificantly (?:improved|prolonged|longer|extended)\b"),
        (2, r"\bstatistically significant and clinically meaningful\b"),
        (2, r"\bpractice[- ]changing\b"),
        (
            1,
            r"\b(?:superior|improved) efficacy\b|\bwas superior to\b"
            r"|\bdemonstrated (?:clinical )?efficacy\b"
            r"|\bclinical benefit\b[^.;]{0,60}\bdemonstrated\b"
            r"|\bencouraging (?:efficacy|activity|results)\b",
        ),
        (-2, r"\bfailed to (?:improve|meet|demonstrate)\b"),
        (-1, r"\bdid not meet\b|\bnot warranted\b"),
    )
)
_BACKGROUND = re.compile(r"\s*(?:BACKGROUND|INTRODUCTION|PURPOSE|OBJECTIVES?|AIMS?)\b")
_CONCLUSION = re.compile(r"\b(?:CONCLUSIONS?|INTERPRETATION)\s*:")
_ABBREV = re.compile(r"\(([A-Z][A-Za-z0-9+-]{1,9})\)")


def _product_pattern(text: str) -> re.Pattern[str]:
    """Our product names plus abbreviations defined right after a phrase that names one."""
    found = {
        m.group(1)
        for m in _ABBREV.finditer(text)
        if OUR_PRODUCTS.search(text, max(0, m.start() - 80), m.start())
    }
    if not found:
        return OUR_PRODUCTS
    extra = "|".join(re.escape(a) for a in sorted(found))
    return re.compile(OUR_PRODUCTS.pattern + rf"|\b(?:{extra})\b")


def efficacy_cue(text: str) -> tuple[int, str] | None:
    """(polarity, span) for the first sentence that judges our product's efficacy, else None.

    The span is an exact substring of `text` inside one sentence.
    """
    prod = _product_pattern(text)
    concl = _CONCLUSION.search(text)
    bounds = sentence_bounds(text)
    if concl:  # conclusions first, then the rest in reading order
        bounds = [x for x in bounds if x[1] > concl.start()] + [
            x for x in bounds if x[1] <= concl.start()
        ]
    for a, b in bounds:
        if _BACKGROUND.match(text, a) or not prod.search(text, a, b):
            continue
        for pol, pat in _EFFICACY_CUES:
            m = pat.search(text, a, b)
            if m and not _negated(text, m.start()):
                return pol, phrase_around(text, m, 12)
    return None


# Ruling 8: "no new safety signals" / "consistent with the known safety profile" = safety 0;
# "manageable" / "well tolerated" = safety +1. Same product check as efficacy.

_SAFETY_ANCHORS = tuple(
    (pol, re.compile(p, re.I))
    for pol, p in (
        (
            0,
            r"\bno new safety (?:signals?|concerns?|findings)\b"
            r"|\bconsistent with (?:the |their )?(?:known|established|previously reported)"
            r"(?: safety)? profiles?\b",
        ),
        (
            1,
            r"\b(?:a |an )?(?:manageable|tolerable|acceptable) (?:safety|tolerability)"
            r"(?: profiles?)?\b|\bwell[- ]tolerated\b",
        ),
    )
)


def safety_anchor(text: str) -> tuple[int, str] | None:
    """(polarity, span) for a ruling 8 safety phrase in a sentence naming our product."""
    prod = _product_pattern(text)
    for a, b in sentence_bounds(text):
        if not prod.search(text, a, b):
            continue
        for pol, pat in _SAFETY_ANCHORS:
            m = pat.search(text, a, b)
            if m and not _negated(text, m.start()):
                return pol, m.group(0)
    return None


# --------------------------------------------------------------------------- entry point

_DISPATCH = {
    "ctgov": ctgov_rules,
    "fda_event": fda_event_rules,
    "fda_label": fda_label_rules,
    "fda_notice": fda_notice_rules,
}


def apply_rules(item: dict[str, Any]) -> RuleResult:
    fn = _DISPATCH.get(item.get("source") or "")
    if fn is not None:
        return fn(item)
    return model_source_rules(item)


# --------------------------------------------------------------------------- aspect checks
# Guide anchors (polarity scale, ruling 8, "pick the milder level") applied to model aspects.

_PLACEHOLDER = re.compile(
    r"(?i)^\W*(none|null|n/?a|not (?:mentioned|stated|applicable|reported))\W*$"
)
_STRONG_POS = re.compile(
    r"(?i)significant|clinically meaningful|practice[- ]changing|longest|unprecedented|unmatched|"
    r"superior|outperform|landmark|substantial|marked|robust|dramatic|best"
)
_STRONG_NEG = re.compile(
    r"(?i)fail|fatal|death|died|unacceptable|boxed|terminat|futility|not warranted|"
    r"contraindicat|life-threatening|discontinu"
)
_SAFETY_ZERO = re.compile(
    r"(?i)no new safety signals?|consistent with (?:the )?(?:known|established|previous\w*)"
    r"(?: safety)? profiles?"
)
_SAFETY_PLUS = re.compile(r"(?i)manageable|well[- ]tolerated|tolerable|favou?rable safety")
_EVIDENCE_MINUS = re.compile(
    r"(?i)retrospective|small sample|limited by|immature|"
    r"further (?:studies|research|investigation)|single[- ]cent(?:er|re)|case report|"
    r"warrant(?:s|ed)? (?:further|validation)"
)


def check_aspect(
    item: dict[str, Any], rule: RuleResult, aspect_name: str, polarity: int, span: str
) -> tuple[int | None, str]:
    """Apply guide anchors to one model aspect. Returns (polarity or None to drop, reason)."""
    if _PLACEHOLDER.match(span) or len(span.split()) < 2:
        return None, "placeholder or one-word span"
    if rule.lab_study:
        # ruling 2: lab studies judge our product only when they say so explicitly
        if aspect_name != "efficacy" or polarity <= 0 or not OUR_PRODUCTS.search(span):
            return None, "lab study does not judge our product (ruling 2)"
    if aspect_name == "safety":
        if _SAFETY_ZERO.search(span):
            return 0, "anchor: known safety profile = 0"
        if _SAFETY_PLUS.search(span) and polarity >= 0:
            return 1, "anchor: manageable / well tolerated = +1"
    if aspect_name == "evidence_quality" and _EVIDENCE_MINUS.search(span):
        return -1, "anchor: author caveat = -1"
    if polarity == 2 and not _STRONG_POS.search(span):
        return 1, "milder: +2 needs a strong cue"
    if polarity == -2 and not _STRONG_NEG.search(span):
        return -1, "milder: -2 needs a strong cue"
    return polarity, ""


_ATTRIBUTION = re.compile(
    r"[\"\u201c\u201d]|\b(?:said|says|say|told|according to|noted|explained|added|commented)\b",
    re.I,
)


def is_attributed(text: str, start: int, end: int) -> bool:
    """True when the sentence holding text[start:end] quotes or attributes a named voice."""
    for a, b in sentence_bounds(text):
        if a <= start < b:
            return bool(_ATTRIBUTION.search(text, a, b))
    return False


def speaker_for(item: dict[str, Any]) -> str:
    """Fixed speaker for every source except news (where the model picks the quoted voice)."""
    if item.get("source") == "fda_event":
        return _reporter_speaker(item.get("text") or "")
    return SOURCE_SPEAKER.get(item.get("source") or "", "media")


__all__ = [
    "ASPECTS",
    "MODEL_SOURCES",
    "RULES_VERSION",
    "RuleResult",
    "apply_rules",
    "speaker_for",
    "phrase_around",
]
