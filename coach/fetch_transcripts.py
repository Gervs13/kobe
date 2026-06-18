#!/usr/bin/env python3
"""Fetch transcripts for every video on the configured channels.

Pipeline:
  1. Use yt-dlp to list ALL video IDs + titles for each channel (a "manifest").
  2. For each video, fetch its transcript with youtube-transcript-api and save
     it as both JSON (timestamped snippets) and plain text.

It is fully **resumable**: re-running skips videos already downloaded, so if
YouTube rate-limits you (or your laptop sleeps) you can just run it again.

MUST be run from a normal residential IP. It will NOT work from a datacenter /
cloud IP (YouTube returns 403) — that's why this lives in your repo to run
locally rather than in the cloud sandbox that generated it.

Usage:
    python fetch_transcripts.py                 # all channels in config.py
    python fetch_transcripts.py --channel hubermanlab
    python fetch_transcripts.py --limit 10      # quick smoke test
    python fetch_transcripts.py --list-only     # just refresh the manifests
"""
from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
import time
from pathlib import Path

import config

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api import _errors as yta_errors
except ImportError:
    sys.exit("Missing dependency. Run:  pip install -r requirements.txt")


# --- Errors that mean "this video has no transcript, move on" ---------------
SKIP_ERRORS = tuple(
    getattr(yta_errors, name)
    for name in ("TranscriptsDisabled", "NoTranscriptFound", "VideoUnavailable",
                 "VideoUnplayable", "NotTranslatable", "TranslationLanguageNotAvailable")
    if hasattr(yta_errors, name)
)
# Errors that mean "YouTube is blocking this IP, slow down / stop"
BLOCK_ERRORS = tuple(
    getattr(yta_errors, name)
    for name in ("IpBlocked", "RequestBlocked", "YouTubeRequestFailed", "TooManyRequests")
    if hasattr(yta_errors, name)
)


def list_channel_videos(channel: dict) -> list[dict]:
    """Return [{id, title}, ...] for every video on the channel via yt-dlp."""
    print(f"  Listing videos for @{channel['slug']} (this can take a minute)...")
    cmd = [
        "yt-dlp", "--flat-playlist", "--no-warnings",
        "--print", "%(id)s\t%(title)s",
        channel["url"],
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=900)
    except FileNotFoundError:
        sys.exit("yt-dlp not found. Run:  pip install -r requirements.txt")
    except subprocess.CalledProcessError as e:
        print(f"  yt-dlp failed for {channel['slug']}:\n{e.stderr[:500]}", file=sys.stderr)
        return []
    videos = []
    for line in out.stdout.splitlines():
        if "\t" not in line:
            continue
        vid, title = line.split("\t", 1)
        vid = vid.strip()
        if vid and vid != "NA":
            videos.append({"id": vid, "title": title.strip()})
    return videos


def load_or_build_manifest(channel: dict, refresh: bool) -> list[dict]:
    """Cache the video list on disk so we don't re-list every run."""
    path = config.MANIFEST_DIR / f"{channel['slug']}.jsonl"
    if path.exists() and not refresh:
        videos = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
        print(f"  Loaded {len(videos)} videos from cached manifest "
              f"({path.name}). Use --refresh to re-list.")
        return videos
    videos = list_channel_videos(channel)
    if videos:
        path.write_text("\n".join(json.dumps(v) for v in videos))
        print(f"  Wrote manifest: {len(videos)} videos -> {path}")
    return videos


def _fetch_one(api: YouTubeTranscriptApi, video_id: str):
    """Return list of snippet dicts, trying manual -> generated -> translated."""
    tl = api.list(video_id)

    # 1) manually-created captions in a preferred language
    try:
        return tl.find_manually_created_transcript(config.PREFERRED_LANGS).fetch()
    except Exception:
        pass
    # 2) auto-generated captions in a preferred language
    try:
        return tl.find_generated_transcript(config.PREFERRED_LANGS).fetch()
    except Exception:
        pass
    # 3) translate whatever exists into our top preferred language
    target = config.PREFERRED_LANGS[0]
    for t in tl:
        if getattr(t, "is_translatable", False):
            try:
                return t.translate(target).fetch()
            except Exception:
                continue
    # 4) last resort: any transcript at all
    for t in tl:
        return t.fetch()
    raise RuntimeError("no transcript variants available")


def _snippets_to_records(fetched) -> list[dict]:
    records = []
    for s in fetched:
        # 1.x returns objects with .text/.start/.duration; be tolerant of dicts too
        if isinstance(s, dict):
            records.append({"text": s.get("text", ""), "start": s.get("start", 0.0),
                            "duration": s.get("duration", 0.0)})
        else:
            records.append({"text": s.text, "start": s.start, "duration": s.duration})
    return records


def fetch_transcripts(channel: dict, videos: list[dict], api: YouTubeTranscriptApi,
                      limit: int | None) -> dict:
    out_dir = config.TRANSCRIPTS_DIR / channel["slug"]
    out_dir.mkdir(parents=True, exist_ok=True)
    fail_log = out_dir / "_failures.jsonl"

    stats = {"ok": 0, "skipped_existing": 0, "no_transcript": 0, "error": 0}
    todo = videos[:limit] if limit else videos

    for i, v in enumerate(todo, 1):
        vid, title = v["id"], v.get("title", "")
        json_path = out_dir / f"{vid}.json"
        if json_path.exists():
            stats["skipped_existing"] += 1
            continue

        attempt = 0
        while True:
            attempt += 1
            try:
                fetched = _fetch_one(api, vid)
                records = _snippets_to_records(fetched)
                payload = {
                    "video_id": vid, "title": title, "channel": channel["slug"],
                    "url": f"https://youtu.be/{vid}",
                    "snippets": records,
                }
                json_path.write_text(json.dumps(payload, ensure_ascii=False))
                (out_dir / f"{vid}.txt").write_text(
                    " ".join(r["text"] for r in records), encoding="utf-8")
                stats["ok"] += 1
                print(f"  [{i}/{len(todo)}] ✓ {vid}  {title[:70]}")
                break
            except SKIP_ERRORS as e:
                stats["no_transcript"] += 1
                _append_fail(fail_log, vid, title, "no_transcript", str(e))
                print(f"  [{i}/{len(todo)}] – {vid}  (no transcript) {title[:55]}")
                break
            except BLOCK_ERRORS as e:
                if attempt <= config.MAX_RETRIES:
                    wait = config.BLOCK_COOLDOWN * attempt
                    print(f"  ! YouTube is blocking requests ({type(e).__name__}). "
                          f"Cooling down {wait:.0f}s (attempt {attempt}/{config.MAX_RETRIES})...")
                    time.sleep(wait)
                    continue
                stats["error"] += 1
                _append_fail(fail_log, vid, title, "blocked", str(e))
                print(f"  [{i}/{len(todo)}] ✗ {vid}  (blocked after retries)")
                break
            except Exception as e:  # noqa: BLE001 - last-resort, log & continue
                if attempt <= 2:
                    time.sleep(2 * attempt)
                    continue
                stats["error"] += 1
                _append_fail(fail_log, vid, title, "error", f"{type(e).__name__}: {e}")
                print(f"  [{i}/{len(todo)}] ✗ {vid}  ({type(e).__name__})")
                break

        time.sleep(random.uniform(config.SLEEP_MIN, config.SLEEP_MAX))
    return stats


def _append_fail(path: Path, vid: str, title: str, kind: str, msg: str) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"video_id": vid, "title": title,
                            "kind": kind, "error": msg[:300]}) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--channel", help="only this channel slug (e.g. hubermanlab)")
    ap.add_argument("--limit", type=int, help="cap videos per channel (testing)")
    ap.add_argument("--refresh", action="store_true", help="re-list videos (ignore cached manifest)")
    ap.add_argument("--list-only", action="store_true", help="build manifests, don't fetch transcripts")
    args = ap.parse_args()

    config.ensure_dirs()
    channels = [c for c in config.CHANNELS if not args.channel or c["slug"] == args.channel]
    if not channels:
        sys.exit(f"No channel matches '{args.channel}'. Known: "
                 + ", ".join(c["slug"] for c in config.CHANNELS))

    proxy = config.proxy_config()
    if proxy:
        print("Using proxy from environment variables.")
    api = YouTubeTranscriptApi(proxy_config=proxy)

    grand = {"ok": 0, "skipped_existing": 0, "no_transcript": 0, "error": 0}
    for ch in channels:
        print(f"\n=== @{ch['slug']} ===")
        videos = load_or_build_manifest(ch, refresh=args.refresh)
        if args.list_only or not videos:
            continue
        s = fetch_transcripts(ch, videos, api, args.limit)
        for k in grand:
            grand[k] += s[k]
        print(f"  → {ch['slug']}: {s}")

    print("\n========== DONE ==========")
    print(f"  new transcripts : {grand['ok']}")
    print(f"  already had     : {grand['skipped_existing']}")
    print(f"  no transcript   : {grand['no_transcript']}")
    print(f"  errors          : {grand['error']}")
    if not args.list_only:
        print("\nNext:  python build_index.py")


if __name__ == "__main__":
    main()
