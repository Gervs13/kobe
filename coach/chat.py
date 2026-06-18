#!/usr/bin/env python3
"""Local coaching chat — talk to a coach that has the transcripts (RAG) + your WHOOP data.

Each message you send retrieves the most relevant transcript excerpts from the
BM25 index and feeds them to Claude alongside your WHOOP summary, so the coach
answers grounded in the two channels' protocols and your real numbers — with
citations.

Setup:
    pip install -r requirements.txt          # includes the anthropic SDK
    export ANTHROPIC_API_KEY=sk-ant-...       # your key from console.anthropic.com
    python build_index.py                     # must exist first
    python whoop.py                           # optional but recommended

Run:
    python chat.py
    python chat.py --k 8         # retrieve more excerpts per turn
    python chat.py --model claude-sonnet-4-6   # cheaper/faster

Type your question and press enter. Commands: /reset, /sources, /quit.
"""
from __future__ import annotations

import argparse
import json
import sys

import config
import whoop
from search import load_index, search, _fmt_ts

MODEL = "claude-opus-4-8"   # latest, most capable; override with --model


def build_system(whoop_text: str) -> list[dict]:
    """Stable per-session context → cache it (system prompt + WHOOP summary)."""
    coach = (config.BASE_DIR / "coach_system_prompt.md").read_text()
    text = (
        f"{coach}\n\n"
        f"---\n\n## MY CURRENT WHOOP DATA\n\n```\n{whoop_text}\n```\n\n"
        "When you reference a protocol, cite the episode title and channel from "
        "the excerpts provided in the user's message. If you go beyond them, say so."
    )
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


def retrieve_block(query: str, k: int, index) -> tuple[str, list[dict]]:
    hits = search(query, k=k, index=index)
    if not hits:
        return "(no relevant transcript excerpts found for this question)", []
    lines = []
    for h in hits:
        lines.append(
            f"[{h['channel']}] {h['title']} @ {_fmt_ts(h['start'])} — {h['url']}\n"
            f"{h['text']}")
    return "\n\n".join(lines), hits


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--k", type=int, default=6, help="excerpts retrieved per message")
    ap.add_argument("--model", default=MODEL)
    args = ap.parse_args()

    try:
        import anthropic
    except ImportError:
        sys.exit("Missing dependency. Run:  pip install -r requirements.txt")

    try:
        index = load_index()
    except SystemExit as e:
        sys.exit(str(e))

    if config.WHOOP_SUMMARY_PATH.exists():
        whoop_text = whoop.to_text(json.loads(config.WHOOP_SUMMARY_PATH.read_text()))
    else:
        whoop_text = "(No WHOOP data yet — add CSVs to data/whoop/ and run whoop.py.)"
        print("! No WHOOP summary found — coaching won't be personalized. "
              "Run whoop.py first.\n")

    client = anthropic.Anthropic()   # reads ANTHROPIC_API_KEY
    system = build_system(whoop_text)
    messages: list[dict] = []
    last_sources: list[dict] = []

    print(f"Coach ready ({args.model}, {len(index['chunks'])} transcript chunks indexed).")
    print("Ask anything. Commands: /reset  /sources  /quit\n")

    while True:
        try:
            user = input("you › ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not user:
            continue
        if user in ("/quit", "/exit", "/q"):
            break
        if user == "/reset":
            messages.clear()
            print("(conversation cleared)\n")
            continue
        if user == "/sources":
            if not last_sources:
                print("(no sources yet)\n")
            for n, h in enumerate(last_sources, 1):
                print(f"  [{n}] {h['url']}  — {h['title']} ({_fmt_ts(h['start'])})")
            print()
            continue

        excerpts, last_sources = retrieve_block(user, args.k, index)
        # Volatile per-turn content (excerpts) goes in the user message, not system,
        # so the cached system prefix stays intact.
        messages.append({
            "role": "user",
            "content": (
                f"Relevant transcript excerpts for this question:\n\n{excerpts}\n\n"
                f"---\n\nMy question: {user}"),
        })

        print("\ncoach › ", end="", flush=True)
        reply_parts: list[str] = []
        try:
            with client.messages.stream(
                model=args.model,
                max_tokens=16000,
                thinking={"type": "adaptive"},
                system=system,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    print(text, end="", flush=True)
                    reply_parts.append(text)
        except anthropic.APIError as e:
            print(f"\n[API error: {e}]\n")
            messages.pop()   # drop the unanswered turn
            continue

        messages.append({"role": "assistant", "content": "".join(reply_parts)})
        print("\n")


if __name__ == "__main__":
    main()
