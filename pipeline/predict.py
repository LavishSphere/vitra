"""Predict CLI.

    python -m pipeline.predict --items <items.full.jsonl> --out <pred.jsonl>
        [--no-model] [--workers N] [--fresh]

Writes one organizer-format JSON line per item (input order) and a sidecar
<out>.meta.jsonl with per-item method / latency / dropped spans. Progress is
appended to <out>.ckpt.jsonl after every item so a crash or sleep can resume
with `--out` pointing at the same path (skip `--fresh`). The few-shot pool is
the labeled dev set unless --pool is given. Exits non-zero if the output fails
validation.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from .api import ModelFn, classify_item
from .data import DEV_GOLD, read_jsonl, write_jsonl
from .schema import public_prediction
from .validate import validate

ProgressFn = Callable[[int, int], None]


def checkpoint_path(out: Path) -> Path:
    return out.with_suffix(out.suffix + ".ckpt.jsonl")


def load_checkpoint(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    done: dict[str, dict[str, Any]] = {}
    for row in read_jsonl(path):
        iid = row.get("item_id")
        if isinstance(iid, str):
            done[iid] = row
    return done


def append_checkpoint(path: Path, row: dict[str, Any], lock: threading.Lock) -> None:
    """Append one finished item. Crash-safe enough for resume (last line may be torn)."""
    line = json.dumps(row, ensure_ascii=False) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    with lock:
        with open(path, "a", encoding="utf-8") as f:
            f.write(line)
            f.flush()
            os.fsync(f.fileno())


def rewrite_checkpoint(path: Path, rows: Sequence[dict[str, Any]]) -> None:
    write_jsonl(path, rows)


def predict_items(
    items: Sequence[dict[str, Any]],
    *,
    use_model: bool,
    workers: int = 1,
    pool_for: Callable[[dict[str, Any]], Sequence[dict[str, Any]] | None] | None = None,
    progress: ProgressFn | None = None,
    model_fn: ModelFn | None = None,
    checkpoint: Path | None = None,
    prior: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Classify items (optionally in parallel); results keep input order and include _meta.

    When `checkpoint` is set, each finished item is appended immediately so a later
    run can skip those ids. `prior` is already-finished rows keyed by item_id.
    """

    prior = dict(prior or {})
    lock = threading.Lock()
    total = len(items)
    pending = [it for it in items if it["item_id"] not in prior]
    done_count = total - len(pending)

    if progress and done_count:
        progress(done_count, total)

    def one(item: dict[str, Any]) -> dict[str, Any]:
        pool = pool_for(item) if pool_for else None
        return classify_item(item, use_model=use_model, fewshot_pool=pool, model_fn=model_fn)

    fresh: dict[str, dict[str, Any]] = {}
    if pending:
        with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
            futures = {ex.submit(one, it): it["item_id"] for it in pending}
            for fut in as_completed(futures):
                iid = futures[fut]
                row = fut.result()
                fresh[iid] = row
                if checkpoint is not None:
                    append_checkpoint(checkpoint, row, lock)
                done_count += 1
                if progress:
                    progress(done_count, total)

    merged = []
    for it in items:
        iid = it["item_id"]
        if iid in fresh:
            merged.append(fresh[iid])
        else:
            merged.append(prior[iid])
    return merged


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
    ap.add_argument(
        "--fresh",
        action="store_true",
        help="ignore any existing checkpoint / out and start from scratch",
    )
    args = ap.parse_args(argv)

    items = read_jsonl(args.items)
    pool = read_jsonl(args.pool) if args.pool and args.pool.exists() else []
    item_ids = {it["item_id"] for it in items}
    # never let an item be its own few-shot example
    pool_for = (lambda it: [p for p in pool if p["item_id"] != it["item_id"]]) if pool else None
    ckpt = checkpoint_path(args.out)
    prior: dict[str, dict[str, Any]] = {}
    if not args.fresh:
        prior = load_checkpoint(ckpt)
        if not prior and args.out.exists():
            # finished file from an older run with no ckpt: treat as done
            prior = {r["item_id"]: r for r in read_jsonl(args.out) if "item_id" in r}
        if prior:
            print(
                f"[predict] resuming {len(prior)} checkpointed item(s) from {ckpt if ckpt.exists() else args.out}",
                file=sys.stderr,
                flush=True,
            )

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
        checkpoint=ckpt,
        prior=prior,
    )
    write_outputs(results, args.out)
    rewrite_checkpoint(ckpt, results)
    elapsed = time.perf_counter() - t0
    report = validate([public_prediction(r) for r in results], items)
    n_err = sum(1 for r in results if r.get("_meta", {}).get("error"))
    summary = {
        "out": str(args.out),
        "n": len(results),
        "elapsed_s": round(elapsed, 1),
        "items_per_min": round(len(results) / elapsed * 60, 1) if elapsed else None,
        "model_errors": n_err,
        "valid": report["valid"],
        "span_in_text": report["span_in_text"],
        "overlap_with_pool": len(item_ids & {p["item_id"] for p in pool}),
        "resumed_from": len(prior),
        "checkpoint": str(ckpt),
    }
    print(json.dumps(summary))
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    sys.exit(main())
