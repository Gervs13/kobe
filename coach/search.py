#!/usr/bin/env python3
"""Search the transcript index. Used on its own or imported by the coach.

CLI:
    python search.py "morning sunlight cortisol"
    python search.py --k 8 --channel hubermanlab "zone 2 cardio"
"""
from __future__ import annotations

import argparse
import pickle
import sys

import config
from build_index import tokenize


def load_index():
    if not config.INDEX_PATH.exists():
        sys.exit(f"No index at {config.INDEX_PATH}. Run  python build_index.py  first.")
    with config.INDEX_PATH.open("rb") as fh:
        return pickle.load(fh)


def search(query: str, k: int = 6, channel: str | None = None, index=None) -> list[dict]:
    index = index or load_index()
    bm25, chunks = index["bm25"], index["chunks"]
    scores = bm25.get_scores(tokenize(query))
    ranked = sorted(range(len(chunks)), key=lambda i: scores[i], reverse=True)
    results = []
    for i in ranked:
        if scores[i] <= 0:
            break
        c = chunks[i]
        if channel and c["channel"] != channel:
            continue
        results.append({**c, "score": float(scores[i])})
        if len(results) >= k:
            break
    return results


def _fmt_ts(seconds: int) -> str:
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("query", nargs="+")
    ap.add_argument("--k", type=int, default=6)
    ap.add_argument("--channel")
    args = ap.parse_args()

    hits = search(" ".join(args.query), k=args.k, channel=args.channel)
    if not hits:
        print("No matches.")
        return
    for n, h in enumerate(hits, 1):
        print(f"\n[{n}] @{h['channel']} — {h['title']}  ({_fmt_ts(h['start'])})")
        print(f"    {h['url']}")
        print(f"    {h['text'][:280]}...")


if __name__ == "__main__":
    main()
