"""Leak-free dev evaluation with the official scorer, plus error analysis.

    python -m pipeline.evaluate --tag rules-only --no-model
    python -m pipeline.evaluate --tag smollm3-q4 --folds 5 --workers 4 --log "notes"

Few-shot examples for a dev item come only from the other folds (stratified by source).
Writes data/derived/runs/<ts>_<tag>/{dev_pred.jsonl, dev_pred.meta.jsonl, score.json, errors.txt}.
With --log, appends a markdown row to the file named by $VITRA_EVAL_LOG
(signed with $VITRA_EVAL_SIGNER, default "local").
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from . import rules
from .data import (
    DERIVED_DIR,
    DEV_GOLD,
    DEV_ITEMS,
    SCORER,
    as_item,
    by_id,
    read_jsonl,
    write_jsonl,
)
from .predict import predict_items, write_outputs
from .schema import ASPECTS

ET = ZoneInfo("America/New_York")


def assign_folds(gold: list[dict[str, Any]], k: int) -> dict[str, int]:
    """Deterministic folds, stratified by source (round-robin over sorted ids)."""
    folds: dict[str, int] = {}
    by_src: dict[str, list[str]] = defaultdict(list)
    for g in sorted(gold, key=lambda r: r["item_id"]):
        by_src[g["source"]].append(g["item_id"])
    i = 0
    for src in sorted(by_src):
        for iid in by_src[src]:
            folds[iid] = i % k
            i += 1
    return folds


def run_scorer(
    pred_path: Path, gold_path: Path = DEV_GOLD, items_path: Path = DEV_ITEMS
) -> dict[str, Any]:
    out = subprocess.run(
        [
            sys.executable,
            "-I",
            str(SCORER),
            "--gold",
            str(gold_path),
            "--pred",
            str(pred_path),
            "--items",
            str(items_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(out.stdout)


def _span_f1(x: str | None, y: str | None) -> float:
    a, b = (x or "").lower().split(), (y or "").lower().split()
    if not a or not b:
        return 0.0
    c = sum((Counter(a) & Counter(b)).values())
    return 0.0 if not c else 2 * (c / len(a)) * (c / len(b)) / (c / len(a) + c / len(b))


def error_report(gold: dict[str, dict[str, Any]], pred: dict[str, dict[str, Any]]) -> str:
    lines: list[str] = []
    conf: Counter[tuple[str, str, str]] = Counter()
    act: Counter[tuple[str, str]] = Counter()
    asp: Counter[tuple[str, str, str]] = Counter()
    pol: Counter[int] = Counter()
    spk: Counter[tuple[str, str, str]] = Counter()
    low_span: list[str] = []
    for iid, g in sorted(gold.items()):
        p = pred.get(iid, {})
        src = g["source"]
        if p.get("signal_type") != g["signal_type"]:
            conf[(src, g["signal_type"], str(p.get("signal_type")))] += 1
        if p.get("actionable") != g["actionable"]:
            act[(src, "FN" if g["actionable"] == "yes" else "FP")] += 1
        for a in ASPECTS:
            ga, pa = g.get(a), p.get(a)
            if ga and not pa:
                asp[(src, a, "FN")] += 1
            elif pa and not ga:
                asp[(src, a, "FP")] += 1
            elif ga and pa:
                pol[abs(ga["polarity"] - pa["polarity"])] += 1
                if ga["speaker"] != pa["speaker"]:
                    spk[(src, ga["speaker"], pa["speaker"])] += 1
                f = _span_f1(pa["span"], ga["span"])
                if f < 0.5:
                    low_span.append(
                        f"{iid} {a} f1={f:.2f} | gold={ga['span'][:70]!r}"
                        f" | pred={pa['span'][:70]!r}"
                    )
    lines.append("## signal confusions (source, gold, pred): n")
    lines += [f"  {k}: {v}" for k, v in conf.most_common()]
    lines.append("## actionable errors (source, FP/FN): n")
    lines += [f"  {k}: {v}" for k, v in act.most_common()]
    lines.append("## aspect errors (source, aspect, FP/FN): n")
    lines += [f"  {k}: {v}" for k, v in asp.most_common()]
    lines.append(f"## polarity |diff| on matched aspects: {dict(sorted(pol.items()))}")
    lines.append("## speaker errors (source, gold, pred): n")
    lines += [f"  {k}: {v}" for k, v in spk.most_common()]
    lines.append("## matched spans with token F1 < 0.5")
    lines += [f"  {s}" for s in low_span]
    return "\n".join(lines)


def _fmt(v: Any) -> str:
    return "-" if v is None else f"{v:.4f}" if isinstance(v, float) else str(v)


def log_row(
    score: dict[str, Any],
    *,
    model: str,
    prompt_v: str,
    mode: str,
    items_per_min: float | None,
    notes: str,
) -> str:
    a = score["all"]
    r = score.get("human_reviewed_only", {})
    cols = [
        datetime.now(ET).strftime("%m-%d %H:%M"),
        os.environ.get("VITRA_EVAL_SIGNER", "local"),
        "uncommitted",
        model,
        prompt_v,
        rules.RULES_VERSION,
        mode,
        _fmt(a["signal_macro_f1"]),
        _fmt(a["actionable_f1"]),
        _fmt(a["aspect_f1"]),
        _fmt(a["polarity_qwk"]),
        _fmt(a["speaker_accuracy"]),
        _fmt(a["span_f1"]),
        _fmt(a.get("citation_validity")),
        f"**{_fmt(a['composite'])}**",
        _fmt(r.get("composite")),
        "-" if items_per_min is None else f"{items_per_min:.1f}",
        notes,
    ]
    return "| " + " | ".join(cols) + " |"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--tag", required=True)
    ap.add_argument("--no-model", action="store_true")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument(
        "--log",
        metavar="NOTES",
        help="append a row with these notes to the log file named by $VITRA_EVAL_LOG",
    )
    ap.add_argument("--policy", help="merge policy name (pipeline.api.POLICIES); default env/full")
    ap.add_argument(
        "--replay",
        type=Path,
        help="re-merge the raw model outputs saved in this run dir (no server)",
    )
    args = ap.parse_args(argv)
    log_path = os.environ.get("VITRA_EVAL_LOG")
    if args.log is not None and not log_path:
        ap.error("--log needs VITRA_EVAL_LOG set to the markdown log file to append to")

    gold_rows = read_jsonl(DEV_GOLD)
    gold = by_id(gold_rows)
    items = [as_item(r) for r in read_jsonl(DEV_ITEMS)]
    folds = assign_folds(gold_rows, args.folds)

    def pool_for(item: dict[str, Any]) -> list[dict[str, Any]]:
        f = folds[item["item_id"]]
        return [g for g in gold_rows if folds[g["item_id"]] != f]

    raw_store: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    if args.replay:
        for row in read_jsonl(args.replay / "raw.jsonl"):
            raw_store[row["item_id"]] = (row["raw"], row["info"])

        def model_fn(item: dict[str, Any], pool: Any) -> tuple[dict[str, Any], dict[str, Any]]:
            if item["item_id"] not in raw_store:
                raise RuntimeError("no saved raw output")
            return raw_store[item["item_id"]]
    else:
        from .model import classify_with_model

        def model_fn(item: dict[str, Any], pool: Any) -> tuple[dict[str, Any], dict[str, Any]]:
            out = classify_with_model(item, pool)
            raw_store[item["item_id"]] = out
            return out

    if args.policy:
        os.environ["VITRA_MERGE_POLICY"] = args.policy
    t0 = time.perf_counter()
    results = predict_items(
        items,
        use_model=not args.no_model,
        workers=args.workers,
        pool_for=pool_for,
        model_fn=model_fn,
        progress=lambda d, n: (
            print(f"[eval] {d}/{n}", file=sys.stderr, flush=True) if d % 10 == 0 or d == n else None
        ),
    )
    elapsed = time.perf_counter() - t0
    run_dir = DERIVED_DIR / "runs" / f"{datetime.now(ET).strftime('%Y%m%d-%H%M%S')}_{args.tag}"
    pred_path = run_dir / "dev_pred.jsonl"
    write_outputs(results, pred_path)
    if raw_store:
        write_jsonl(
            run_dir / "raw.jsonl",
            ({"item_id": k, "raw": v[0], "info": v[1]} for k, v in sorted(raw_store.items())),
        )
    score = run_scorer(pred_path)

    metas = [r["_meta"] for r in results]
    model_metas = [m for m in metas if m.get("model_latency_ms") is not None]
    lat = sorted(m["model_latency_ms"] for m in model_metas)
    n_model_items = len(model_metas) + sum(
        1 for m in metas if str(m.get("error") or "").startswith("model failed")
    )
    perf = {
        "elapsed_s": round(elapsed, 1),
        "items_per_min_all": round(len(items) / elapsed * 60, 1) if elapsed else None,
        "n_model_calls_ok": len(model_metas),
        "n_model_items": n_model_items,
        "json_valid_rate": round(len(model_metas) / n_model_items, 4)
        if n_model_items and not args.no_model
        else None,
        "model_errors": [m["error"] for m in metas if m.get("error")][:5],
        "p50_ms": statistics.median(lat) if lat else None,
        "p95_ms": lat[min(len(lat) - 1, int(0.95 * len(lat)))] if lat else None,
        "model_items_per_min": round(len(model_metas) / elapsed * 60, 1)
        if model_metas and elapsed
        else None,
        "dropped_spans": sum(len(m.get("dropped_spans", [])) for m in metas),
        "model": next((m["model"] for m in model_metas if m.get("model")), None),
        "prompt_version": next(
            (m["prompt_version"] for m in model_metas if m.get("prompt_version")), None
        ),
        "merge_policy": next(
            (m["merge_policy"] for m in model_metas if m.get("merge_policy")), None
        ),
    }
    pred = by_id(read_jsonl(pred_path))
    errors = error_report(gold, pred)
    (run_dir / "score.json").write_text(json.dumps({"score": score, "perf": perf}, indent=1))
    (run_dir / "errors.txt").write_text(errors)
    mode = (
        "rules (no few-shot)"
        if args.no_model
        else f"k-fold({args.folds})" + (" replay" if args.replay else "")
    )
    model_name = (
        "none" if args.no_model else (perf["model"] or os.environ.get("VITRA_MODEL_NAME", "?"))
    )
    pv = (perf["prompt_version"] or "-") + (
        f" / {perf['merge_policy']}" if perf["merge_policy"] else ""
    )
    row = log_row(
        score,
        model=model_name,
        prompt_v=pv,
        mode=mode,
        items_per_min=perf["model_items_per_min"],
        notes=args.log or "",
    )
    print(
        json.dumps(
            {
                "run_dir": str(run_dir),
                "all": score["all"],
                "reviewed": score.get("human_reviewed_only", {}).get("composite"),
                "perf": perf,
            },
            indent=1,
        )
    )
    print(errors)
    print(row)
    if args.log is not None:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(row + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
