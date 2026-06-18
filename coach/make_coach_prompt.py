#!/usr/bin/env python3
"""Assemble a ready-to-paste coaching prompt.

Combines:
  - the coach system prompt (coach_system_prompt.md)
  - your WHOOP summary (data/whoop_summary.json, from whoop.py)
  - the most relevant transcript excerpts, retrieved from the BM25 index based
    on what your WHOOP data flags (low recovery -> sleep/recovery protocols, etc.)

Writes coach_prompt.md. Paste that whole file into Claude or ChatGPT to start a
coaching session grounded in the two channels + your real data.

Usage:
    python make_coach_prompt.py
    python make_coach_prompt.py --topics "morning routine,zone 2,caffeine timing"
    python make_coach_prompt.py --per-topic 3
"""
from __future__ import annotations

import argparse
import json
import sys

import config
import whoop
from search import load_index, search, _fmt_ts

# Each flag/metric maps to search queries that pull the right protocols.
FLAG_TO_QUERIES = {
    "recovery": ["how to improve recovery and HRV", "rest days overtraining recovery",
                 "parasympathetic nervous system downregulation"],
    "sleep":    ["how to improve deep sleep and REM", "sleep hygiene protocol temperature light",
                 "morning sunlight viewing circadian rhythm", "caffeine timing and sleep"],
    "hrv":      ["increase heart rate variability", "breathing protocols stress HRV"],
    "resting_hr": ["lower resting heart rate cardiovascular fitness", "zone 2 cardio"],
    "strain":   ["training load and recovery balance", "exercise intensity overtraining"],
    "sleep_debt": ["sleep debt and catching up on sleep", "naps and sleep need"],
}

# Always-useful baseline topics so the prompt isn't only reactive.
DEFAULT_TOPICS = ["morning routine for energy and focus",
                  "exercise protocol for longevity and fitness",
                  "nutrition and meal timing", "supplements evidence based"]


def queries_from_summary(summary: dict) -> list[str]:
    qs: list[str] = []
    m = summary.get("metrics", {})

    def avg7(name):
        d = m.get(name, {}).get("last_7d")
        return d["avg"] if d else None

    if (avg7("recovery") or 100) < 60:
        qs += FLAG_TO_QUERIES["recovery"]
    if (avg7("sleep_performance") or 100) < 80 or (avg7("sleep_debt_min") or 0) > 30:
        qs += FLAG_TO_QUERIES["sleep"] + FLAG_TO_QUERIES["sleep_debt"]
    if "hrv" in m:
        qs += FLAG_TO_QUERIES["hrv"]
    if (avg7("resting_hr") or 0) > 60:
        qs += FLAG_TO_QUERIES["resting_hr"]
    if (avg7("day_strain") or 0) > 12:
        qs += FLAG_TO_QUERIES["strain"]
    # de-dup, keep order
    seen, out = set(), []
    for q in qs + DEFAULT_TOPICS:
        if q not in seen:
            seen.add(q)
            out.append(q)
    return out


def gather_excerpts(queries: list[str], per_topic: int, index) -> list[dict]:
    seen_ids, excerpts = set(), []
    for q in queries:
        for hit in search(q, k=per_topic, index=index):
            key = (hit["video_id"], hit["start"])
            if key in seen_ids:
                continue
            seen_ids.add(key)
            excerpts.append({**hit, "matched_topic": q})
    return excerpts


def render_excerpts(excerpts: list[dict]) -> str:
    out = []
    for e in excerpts:
        out.append(
            f"### [{e['channel']}] {e['title']} @ {_fmt_ts(e['start'])}\n"
            f"{e['url']}  (topic: {e['matched_topic']})\n\n"
            f"> {e['text']}\n")
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--topics", help="comma-separated extra topics to pull protocols for")
    ap.add_argument("--per-topic", type=int, default=2, help="excerpts per topic (default 2)")
    args = ap.parse_args()

    system = (config.BASE_DIR / "coach_system_prompt.md").read_text()

    # WHOOP context (optional — prompt still works without it)
    if config.WHOOP_SUMMARY_PATH.exists():
        summary = json.loads(config.WHOOP_SUMMARY_PATH.read_text())
        whoop_text = whoop.to_text(summary)
        queries = queries_from_summary(summary)
    else:
        summary, whoop_text = None, ("(No WHOOP data yet. Add CSVs to data/whoop/ and "
                                     "run  python whoop.py  to personalize this.)")
        queries = DEFAULT_TOPICS[:]
        print("! No whoop_summary.json — building a generic prompt. "
              "Run whoop.py first for personalization.")

    if args.topics:
        queries = [t.strip() for t in args.topics.split(",") if t.strip()] + queries

    try:
        index = load_index()
    except SystemExit:
        sys.exit("Build the transcript index first:  python build_index.py")

    excerpts = gather_excerpts(queries, args.per_topic, index)

    doc = f"""{system}

---

## MY CURRENT WHOOP DATA

```
{whoop_text}
```

---

## RELEVANT PROTOCOLS FROM THE TRANSCRIPTS
*(retrieved from {len(index['chunks'])} indexed transcript chunks, matched to my data)*

{render_excerpts(excerpts)}

---

## YOUR TASK
Using the system prompt above, my WHOOP data, and these transcript excerpts,
coach me for the coming week. Follow the default output shape. Cite the excerpts
by episode title when you use them, and tell me when you're going beyond them.
"""
    config.COACH_PROMPT_PATH.write_text(doc, encoding="utf-8")
    print(f"Wrote {config.COACH_PROMPT_PATH}  "
          f"({len(excerpts)} excerpts from {len(queries)} topics).")
    print("Paste that file into Claude or ChatGPT to start coaching.")


if __name__ == "__main__":
    main()
