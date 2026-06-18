#!/usr/bin/env python3
"""Build a searchable BM25 index over every downloaded transcript.

We chunk each transcript into ~45-second / ~700-word windows so a search hit
points at a specific moment in a specific video (with a clickable timestamp
link), not just "somewhere in this 3-hour episode".

Output: data/index.pkl  (chunks + their BM25 model)

Usage:  python build_index.py
"""
from __future__ import annotations

import json
import pickle
import re
import sys
from pathlib import Path

import config

try:
    from rank_bm25 import BM25Okapi
except ImportError:
    sys.exit("Missing dependency. Run:  pip install -r requirements.txt")

CHUNK_WORDS = 220        # ~1-2 min of speech; small enough to be a precise citation
CHUNK_OVERLAP = 40       # words shared between adjacent chunks for continuity

_token_re = re.compile(r"[a-z0-9']+")


def tokenize(text: str) -> list[str]:
    return _token_re.findall(text.lower())


def chunk_transcript(payload: dict) -> list[dict]:
    """Group consecutive snippets into word-bounded chunks with start times."""
    snippets = payload.get("snippets", [])
    chunks, cur_words, cur_start = [], [], None
    for s in snippets:
        if cur_start is None:
            cur_start = s.get("start", 0.0)
        words = s.get("text", "").split()
        cur_words.extend(words)
        if len(cur_words) >= CHUNK_WORDS:
            chunks.append(_make_chunk(payload, cur_start, cur_words))
            cur_words = cur_words[-CHUNK_OVERLAP:] if CHUNK_OVERLAP else []
            cur_start = s.get("start", 0.0)
    if cur_words:
        chunks.append(_make_chunk(payload, cur_start or 0.0, cur_words))
    return chunks


def _make_chunk(payload: dict, start: float, words: list[str]) -> dict:
    vid = payload["video_id"]
    return {
        "channel": payload.get("channel", ""),
        "video_id": vid,
        "title": payload.get("title", ""),
        "start": int(start),
        "url": f"https://youtu.be/{vid}?t={int(start)}",
        "text": " ".join(words),
    }


def main() -> None:
    config.ensure_dirs()
    files = sorted(config.TRANSCRIPTS_DIR.glob("*/*.json"))
    if not files:
        sys.exit(f"No transcripts found under {config.TRANSCRIPTS_DIR}. "
                 "Run  python fetch_transcripts.py  first.")

    chunks: list[dict] = []
    for f in files:
        try:
            payload = json.loads(f.read_text())
        except Exception as e:  # noqa: BLE001
            print(f"  skip {f.name}: {e}")
            continue
        chunks.extend(chunk_transcript(payload))

    print(f"Indexing {len(chunks)} chunks from {len(files)} transcripts...")
    corpus = [tokenize(c["text"]) for c in chunks]
    bm25 = BM25Okapi(corpus)

    with config.INDEX_PATH.open("wb") as fh:
        pickle.dump({"bm25": bm25, "chunks": chunks}, fh)
    print(f"Wrote index -> {config.INDEX_PATH}")
    print("Next:  python search.py \"how to improve deep sleep\"")


if __name__ == "__main__":
    main()
