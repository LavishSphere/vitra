"""Submission validator.

    python -m pipeline.validate --pred <file> --items <items.full.jsonl>

Checks: one line per item, ids match exactly, no duplicates, all keys present,
enums valid, and every span is an exact substring of the item text.
Prints counts only (never item text). Exit code 0 means valid.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from .data import read_jsonl
from .schema import ASPECTS, prediction_errors


def validate(pred_rows: list[dict[str, Any]], items: list[dict[str, Any]]) -> dict[str, Any]:
    item_text = {it["item_id"]: it.get("text") for it in items}
    ids = [r.get("item_id") for r in pred_rows]
    dup = [i for i, c in Counter(ids).items() if c > 1]
    missing = sorted(set(item_text) - set(ids))
    extra = sorted(set(ids) - set(item_text))
    row_errors: dict[str, list[str]] = {}
    n_spans = n_ok = 0
    for r in pred_rows:
        text = item_text.get(r.get("item_id"))
        errs = prediction_errors(r, text if isinstance(text, str) else None)
        if text is None:
            errs.append("item text missing (span check skipped)")
        if errs:
            row_errors[str(r.get("item_id"))] = errs
        for a in ASPECTS:
            v = r.get(a)
            if isinstance(v, dict):
                n_spans += 1
                n_ok += (
                    isinstance(text, str) and isinstance(v.get("span"), str) and v["span"] in text
                )
    report = {
        "n_lines": len(pred_rows),
        "n_items": len(item_text),
        "duplicates": len(dup),
        "missing": len(missing),
        "extra": len(extra),
        "rows_with_errors": len(row_errors),
        "n_spans": n_spans,
        "span_in_text": (n_ok / n_spans) if n_spans else 1.0,
        "signal_counts": dict(Counter(r.get("signal_type") for r in pred_rows)),
        "actionable_yes": sum(r.get("actionable") == "yes" for r in pred_rows),
        "aspect_counts": {a: sum(isinstance(r.get(a), dict) for r in pred_rows) for a in ASPECTS},
    }
    report["valid"] = (
        not dup
        and not missing
        and not extra
        and not row_errors
        and len(pred_rows) == len(item_text)
        and report["span_in_text"] == 1.0
    )
    # error kinds only, never text
    report["error_kinds"] = dict(
        Counter(e.split(":")[0] if ":" in e else e for errs in row_errors.values() for e in errs)
    )
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--pred", required=True, type=Path)
    ap.add_argument("--items", required=True, type=Path)
    args = ap.parse_args(argv)
    report = validate(read_jsonl(args.pred), read_jsonl(args.items))
    print(json.dumps(report, indent=1))
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    sys.exit(main())
