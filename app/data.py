"""Load package items and labels, and hold the in-memory evidence store.

Label sources, in priority order (the first one that covers an item wins):
1. Dev gold (`<package>/data/dev.jsonl`) -> origin "gold_dev", method "gold".
2. Every `*.jsonl` in the predictions directory (default data/derived/predictions/),
   read in name order, except `*.meta.jsonl` sidecars -> origin "predicted".
   The method comes from the line's `_meta.method`, else from the sidecar
   `<name>.meta.jsonl` that `python -m pipeline.predict` writes next to its
   output, when it is rule|model|mixed; otherwise "model" with a note.

Item text always comes from the package `*.full.jsonl` files (PubMed abstracts
are only present there). Prediction lines whose item_id is unknown are skipped
and counted. Nothing here logs item text.

Private transcripts are held in a process-local list only. They are never
written anywhere, and are cleared by `reset_transcripts()` and at shutdown.
"""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import Settings
from .evidence import annotate, build_item
from .models import EvidenceItem

log = logging.getLogger("vitra.data")

ITEM_FILES = ("dev.full.jsonl", "test_inputs.full.jsonl", "unlabeled.full.jsonl")
GOLD_FILE = "dev.jsonl"
VALID_METHODS = {"rule", "model", "mixed"}


@dataclass
class LoadReport:
    items_indexed: int = 0
    gold_labels: int = 0
    predicted_labels: dict[str, int] = field(default_factory=dict)
    skipped: dict[str, int] = field(default_factory=dict)
    missing_files: list[str] = field(default_factory=list)

    def skip(self, reason: str) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + 1


def _iter_jsonl(path: Path, report: LoadReport) -> Iterator[dict[str, Any]]:
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                report.skip(f"{path.name}: invalid JSON line")
                continue
            if isinstance(row, dict):
                yield row
            else:
                report.skip(f"{path.name}: line is not an object")


def load_evidence(settings: Settings) -> tuple[list[EvidenceItem], LoadReport]:
    """Build un-annotated EvidenceItems for every labeled item."""
    report = LoadReport()
    items: dict[str, dict[str, Any]] = {}
    for name in ITEM_FILES:
        path = settings.data_dir / name
        if not path.exists():
            report.missing_files.append(str(path))
            continue
        for row in _iter_jsonl(path, report):
            if row.get("item_id") and isinstance(row.get("text"), str):
                items[row["item_id"]] = row
    report.items_indexed = len(items)

    labeled: dict[str, EvidenceItem] = {}

    gold_path = settings.data_dir / GOLD_FILE
    if gold_path.exists():
        for row in _iter_jsonl(gold_path, report):
            item = items.get(row.get("item_id", ""))
            if item is None:
                report.skip("gold: item text not available")
                continue
            ev = _safe_build(item, row, "gold_dev", "gold", (), report)
            if ev is not None:
                labeled[item["item_id"]] = ev
                report.gold_labels += 1
    else:
        report.missing_files.append(str(gold_path))

    pred_dir = settings.predictions_dir
    pred_files = sorted(pred_dir.glob("*.jsonl")) if pred_dir.is_dir() else []
    for path in [p for p in pred_files if not p.name.endswith(".meta.jsonl")]:
        sidecar = _sidecar_methods(path.with_suffix(".meta.jsonl"), report)
        n = 0
        for row in _iter_jsonl(path, report):
            iid = row.get("item_id", "")
            if iid in labeled:
                report.skip("prediction: item already labeled by a higher-priority source")
                continue
            item = items.get(iid)
            if item is None:
                report.skip("prediction: unknown item_id")
                continue
            meta = row.get("_meta") if isinstance(row.get("_meta"), dict) else {}
            method = meta.get("method") or sidecar.get(iid)
            notes: tuple[str, ...] = ()
            if method not in VALID_METHODS:
                method, notes = (
                    "model",
                    ("label method not recorded in the prediction file; treated as model",),
                )
            ev = _safe_build(item, row, "predicted", method, notes, report)
            if ev is not None:
                labeled[iid] = ev
                n += 1
        report.predicted_labels[path.name] = n

    evidence = list(labeled.values())
    evidence.sort(key=lambda e: (e.published, e.item_id))
    return evidence, report


def _sidecar_methods(path: Path, report: LoadReport) -> dict[str, str]:
    if not path.exists():
        return {}
    return {
        r["item_id"]: r["method"]
        for r in _iter_jsonl(path, report)
        if isinstance(r.get("item_id"), str) and r.get("method") in VALID_METHODS
    }


def _safe_build(
    item: dict[str, Any],
    label: dict[str, Any],
    origin: str,
    method: str,
    notes: tuple[str, ...],
    report: LoadReport,
) -> EvidenceItem | None:
    try:
        return build_item(item, label, origin=origin, method=method, extra_notes=notes)
    except Exception as exc:  # malformed label: count it, never echo its content
        report.skip(f"{origin}: invalid label ({type(exc).__name__})")
        return None


class EvidenceStore:
    """Base evidence (loaded once) plus transcripts held in memory for this process."""

    def __init__(self, settings: Settings, base: list[EvidenceItem] | None = None) -> None:
        self._settings = settings
        self._lock = threading.Lock()
        self._base: list[EvidenceItem] | None = base
        self._report = LoadReport() if base is not None else None
        self._transcripts: list[EvidenceItem] = []
        self._annotated: list[EvidenceItem] | None = None
        self._by_id: dict[str, EvidenceItem] = {}
        self._transcript_seq = 0

    def load(self) -> None:
        with self._lock:
            if self._base is None:
                self._base, self._report = load_evidence(self._settings)
                r = self._report
                log.info(
                    "evidence loaded: %d items indexed, %d gold, predicted=%s, "
                    "skipped=%s, missing=%d",
                    r.items_indexed,
                    r.gold_labels,
                    r.predicted_labels,
                    r.skipped,
                    len(r.missing_files),
                )
                self._annotated = None

    @property
    def report(self) -> LoadReport:
        self.load()
        assert self._report is not None
        return self._report

    def raw(self) -> list[EvidenceItem]:
        """Un-annotated evidence (base + held transcripts): the input to every recompute."""
        self.load()
        with self._lock:
            return list(self._base or []) + list(self._transcripts)

    def annotated(self) -> list[EvidenceItem]:
        """Evidence with confidence computed over the full current set (cached)."""
        raw = self.raw()
        with self._lock:
            if self._annotated is None:
                self._annotated = annotate(raw)
                self._by_id = {e.item_id: e for e in self._annotated}
            return self._annotated

    def get(self, item_id: str) -> EvidenceItem | None:
        self.annotated()
        return self._by_id.get(item_id)

    def add_transcript(self, item: EvidenceItem) -> None:
        with self._lock:
            self._transcripts.append(item)
            self._annotated = None

    @property
    def n_transcripts(self) -> int:
        return len(self._transcripts)

    def next_transcript_id(self) -> str:
        # Monotonic for the process lifetime, so ids are never reused after a reset.
        with self._lock:
            self._transcript_seq += 1
            return f"PT-{self._transcript_seq:04d}"

    def reset_transcripts(self) -> int:
        with self._lock:
            n = len(self._transcripts)
            self._transcripts.clear()
            self._annotated = None
            return n
