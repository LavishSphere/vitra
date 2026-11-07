"""Span snapping: turn a model-proposed quote into an exact substring of the item text.

Order of attempts (first hit wins):
  1. exact substring
  2. cleaned (surrounding quotes / trailing punctuation removed), exact
  3. case-insensitive
  4. normalized (case + whitespace runs + curly quotes / dashes folded)
  5. fuzzy: best token window inside a single sentence, above FUZZY_THRESHOLD
Every hit is clipped to one sentence (guide ruling 10). If nothing works the span is
unverifiable and the caller must drop the aspect.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

FUZZY_THRESHOLD = 0.8
MAX_FUZZY_TOKENS = 40

_ELLIPSIS = re.compile(r"\s*(?:\[\s*\.\.\.\s*\]|\[…\]|…|\.\.\.)\s*")
_TRAIL_PUNCT = ",;:."
_QUOTES = "\"'“”‘’`«»"
_FOLD = str.maketrans(
    {
        "\u2019": "'",
        "\u2018": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u2011": "-",
        "\u00a0": " ",
    }
)
_ABBREV = {
    "et al.",
    "e.g.",
    "i.e.",
    "vs.",
    "dr.",
    "fig.",
    "no.",
    "approx.",
    "inc.",
    "co.",
    "ltd.",
    "mr.",
    "ms.",
    "prof.",
    "st.",
    "jr.",
    "u.s.",
    "u.k.",
    "ref.",
    "etc.",
}
_BOUNDARY = re.compile(
    r"(?<=[.!?])[\"”)']?\s+(?=[\"“(\[]?[A-Z0-9])|\s*(?:\[\s*\.\.\.\s*\]|…)\s*|\n+|\s#{2,}\s*"
)


def sentence_bounds(text: str) -> list[tuple[int, int]]:
    """(start, end) offsets of sentences; never crosses '…', '[...]' or a markdown heading."""
    cuts: list[tuple[int, int]] = []
    for m in _BOUNDARY.finditer(text):
        before = text[max(0, m.start() - 8) : m.start()].lower()
        if m.group(0).strip() == "" and any(before.endswith(a) for a in _ABBREV):
            continue
        cuts.append((m.start(), m.end()))
    bounds: list[tuple[int, int]] = []
    pos = 0
    for a, b in cuts:
        if a > pos:
            bounds.append((pos, a))
        pos = b
    if pos < len(text):
        bounds.append((pos, len(text)))
    return [(s, e) for s, e in (_strip_bounds(text, s, e) for s, e in bounds) if e > s]


def _strip_bounds(text: str, s: int, e: int) -> tuple[int, int]:
    while s < e and text[s].isspace():
        s += 1
    while e > s and text[e - 1].isspace():
        e -= 1
    return s, e


def _normalize(text: str, fold_case: bool, fold_space: bool) -> tuple[str, list[int]]:
    """Normalized copy of `text` plus a map from each normalized char to its original index."""
    out: list[str] = []
    idx: list[int] = []
    prev_space = False
    for i, ch in enumerate(text):
        if fold_space:
            ch = ch.translate(_FOLD)
            if ch.isspace():
                if prev_space:
                    continue
                ch = " "
                prev_space = True
            else:
                prev_space = False
        piece = ch.lower() if fold_case else ch
        for c in piece:
            out.append(c)
            idx.append(i)
    return "".join(out), idx


def _find_normalized(
    span: str, text: str, fold_case: bool, fold_space: bool
) -> tuple[int, int] | None:
    nt, imap = _normalize(text, fold_case, fold_space)
    ns, _ = _normalize(span, fold_case, fold_space)
    ns = ns.strip()
    if not ns:
        return None
    pos = nt.find(ns)
    if pos < 0:
        return None
    return imap[pos], imap[pos + len(ns) - 1] + 1


def _clean(span: str) -> str:
    s = span.strip()
    while s and (s[0] in _QUOTES or s[-1] in _QUOTES or s[-1] in _TRAIL_PUNCT):
        if s[0] in _QUOTES:
            s = s[1:]
        elif s[-1] in _QUOTES or s[-1] in _TRAIL_PUNCT:
            s = s[:-1]
        s = s.strip()
    return s


def _tok(s: str) -> str:
    return s.lower().translate(_FOLD).strip(".,;:()[]{}\"'“”‘’!?")


def _fuzzy(span: str, text: str) -> tuple[int, int] | None:
    want = [t for t in (_tok(x) for x in span.split()) if t]
    if len(want) < 2 or len(want) > MAX_FUZZY_TOKENS:
        return None
    best: tuple[float, int, int] | None = None
    for s0, e0 in sentence_bounds(text):
        toks = [
            (m.start() + s0, m.end() + s0, _tok(m.group(0)))
            for m in re.finditer(r"\S+", text[s0:e0])
        ]
        if not toks:
            continue
        n = len(want)
        for size in range(max(1, n - 3), n + 4):
            for i in range(0, max(1, len(toks) - size + 1)):
                window = toks[i : i + size]
                ratio = SequenceMatcher(None, want, [t[2] for t in window], autojunk=False).ratio()
                if best is None or ratio > best[0]:
                    best = (ratio, window[0][0], window[-1][1])
    if best is None or best[0] < FUZZY_THRESHOLD:
        return None
    return best[1], best[2]


def _clip_to_sentence(text: str, s: int, e: int) -> tuple[int, int]:
    """Keep the part of [s, e) that lies in the single sentence it overlaps most."""
    best = (0, s, e)
    for a, b in sentence_bounds(text):
        lo, hi = max(a, s), min(b, e)
        if hi - lo > best[0]:
            best = (hi - lo, lo, hi)
    _, s, e = best
    s, e = _strip_bounds(text, s, e)
    while e > s and text[e - 1] in _TRAIL_PUNCT:
        e -= 1
    return s, e


def _locate_piece(span: str, text: str) -> tuple[int, int, str] | None:
    pos = text.find(span)
    if pos >= 0:
        return pos, pos + len(span), "exact"
    cleaned = _clean(span)
    if cleaned and cleaned != span:
        pos = text.find(cleaned)
        if pos >= 0:
            return pos, pos + len(cleaned), "exact"
    target = cleaned or span
    for method, hit in (
        ("case", lambda: _find_normalized(target, text, fold_case=True, fold_space=False)),
        ("normalized", lambda: _find_normalized(target, text, fold_case=True, fold_space=True)),
        ("fuzzy", lambda: _fuzzy(target, text)),
    ):
        loc = hit()
        if loc is not None:
            return loc[0], loc[1], method
    return None


def locate_span_detail(span: str, text: str) -> tuple[int, int, str] | None:
    """Like locate_span, plus how it matched: exact | case | normalized | fuzzy."""
    if not isinstance(span, str) or not isinstance(text, str) or not span.strip() or not text:
        return None
    pieces = [p for p in _ELLIPSIS.split(span) if p.strip()]
    piece = max(pieces, key=len) if pieces else span  # never span across an ellipsis
    hit = _locate_piece(piece, text)
    if hit is None:
        return None
    s, e = _clip_to_sentence(text, hit[0], hit[1])
    return (s, e, hit[2]) if e > s else None


def locate_span(span: str, text: str) -> tuple[int, int] | None:
    """Exact-substring location of `span` in `text` after snapping; None if unverifiable.

    The returned slice text[start:end] lies inside one sentence and is what should be emitted.
    """
    hit = locate_span_detail(span, text)
    return None if hit is None else (hit[0], hit[1])


_NUMERIC_TAIL = re.compile(r"\s*[(\[][^()\[\]]*\d[^()\[\]]*(?:[)\]]|$)")


def trim_numeric_tail(text: str, start: int, end: int, min_words: int = 3) -> tuple[int, int]:
    """Cut a span before its first parenthetical that holds numbers ("(HR 0.48; 95% CI ...").

    Gold quotes keep the judging words, not the statistics. Only trims when at least
    `min_words` words remain before the parenthesis.
    """
    m = _NUMERIC_TAIL.search(text, start, end)
    if m is None or m.start() <= start:
        return start, end
    cut = m.start()
    if len(text[start:cut].split()) < min_words:
        return start, end
    while cut > start and text[cut - 1] in _TRAIL_PUNCT + " ":
        cut -= 1
    return start, cut


_CLAUSE_CUT = re.compile(r",\s|;\s|:\s|\s(?:and|while|whereas|which|but)\s")


def shift_later_clause(
    text: str,
    quote_start: int,
    quote_end: int,
    span_start: int,
    span_end: int,
) -> tuple[int, int]:
    """Placeholder. The short numeric stub stays where the trim left it."""
    return span_start, span_end


def shorten_span(text: str, start: int, end: int, max_words: int = 12) -> tuple[int, int]:
    """Cut an over-long span at its first clause boundary that leaves 4 or more words.

    The guide asks for the shortest phrase that justifies the label; long model quotes
    usually carry the judgment in their first clause.
    """
    if len(text[start:end].split()) <= max_words:
        return start, end
    for m in _CLAUSE_CUT.finditer(text, start, end):
        if len(text[start : m.start()].split()) >= 4:
            cut = m.start()
            while cut > start and text[cut - 1] in _TRAIL_PUNCT + " ":
                cut -= 1
            return start, cut
    return start, end


def snap_span(span: str, text: str) -> str | None:
    """The exact text slice for `span`, or None when it can't be verified."""
    loc = locate_span(span, text)
    if loc is None:
        return None
    out = text[loc[0] : loc[1]]
    return out if out and out in text else None
