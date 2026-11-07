"""Predict CLI.

    python -m pipeline.predict --items <items.full.jsonl> --out <pred.jsonl>
        [--no-model] [--workers N]

Writes one organizer-format JSON line per item (input order) and a sidecar
<out>.meta.jsonl with per-item method / latency / dropped spans. The few-shot pool is
the labeled dev set unless --pool is given. Exits non-zero if the output fails validation.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from .api import ModelFn, classify_item
from .data import DEV_GOLD, read_jsonl, write_jsonl
from .schema import public_prediction
from .validate import validate

ProgressFn = Callable[[int, int], None]


def predict_items(
    items: Sequence[dict[str, Any]],
    *,
    use_model: bool,
    workers: int = 1,
    pool_for: Callable[[dict[str, Any]], Sequence[dict[str, Any]] | None] | None = None,
    progress: ProgressFn | None = None,
    model_fn: ModelFn | None = None,
) -> list[dict[str, Any]]:
    """Classify items (optionally in parallel); results keep input order and include _meta."""

    def one(item: dict[str, Any]) -> dict[str, Any]:
        pool = pool_for(item) if pool_for else None
        return classify_item(item, use_model=use_model, fewshot_pool=pool, model_fn=model_fn)

    out: list[dict[str, Any] | None] = [None] * len(items)
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        futures = {ex.submit(one, it): i for i, it in enumerate(items)}
        done = 0
        for fut in futures:  # iterate in submission order; each result is independent
            out[futures[fut]] = fut.result()
            done += 1
            if progress:
                progress(done, len(items))
    return [r for r in out if r is not None]


def write_outputs(results: list[dict[str, Any]], out: Path) -> None:
    write_jsonl(out, (public_prediction(r) for r in results))
    write_jsonl(
        out.with_suffix(".meta.jsonl"),
        ({"item_id": r["item_id"], **r.get("_meta", {})} for r in results),
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--items", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--no-model", action="store_true", help="rules only, no llama-server needed")
    ap.add_argument(
        "--workers", type=int, default=1, help="concurrent model requests (match llama-server -np)"
    )
    ap.add_argument(
        "--pool", type=Path, default=DEV_GOLD, help="labeled few-shot pool (default: dev gold)"
    )
    args = ap.parse_args(argv)

    items = read_jsonl(args.items)
    pool = read_jsonl(args.pool) if args.pool and args.pool.exists() else []
    item_ids = {it["item_id"] for it in items}
    # never let an item be its own few-shot example
    pool_for = (lambda it: [p for p in pool if p["item_id"] != it["item_id"]]) if pool else None
    t0 = time.perf_counter()

    def progress(done: int, total: int) -> None:
        if done % 10 == 0 or done == total:
            el = time.perf_counter() - t0
            print(f"[predict] {done}/{total} items, {el:.0f}s elapsed", file=sys.stderr, flush=True)

    results = predict_items(
        items,
        use_model=not args.no_model,
        workers=args.workers,
        pool_for=pool_for,
        progress=progress,
    )
    write_outputs(results, args.out)
    elapsed = time.perf_counter() - t0
    report = validate([public_prediction(r) for r in results], items)
    n_err = sum(1 for r in results if r["_meta"].get("error"))
    summary = {
        "out": str(args.out),
        "n": len(results),
        "elapsed_s": round(elapsed, 1),
        "items_per_min": round(len(results) / elapsed * 60, 1) if elapsed else None,
        "model_errors": n_err,
        "valid": report["valid"],
        "span_in_text": report["span_in_text"],
        "overlap_with_pool": len(item_ids & {p["item_id"] for p in pool}),
    }
    print(json.dumps(summary))
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    sys.exit(main())
