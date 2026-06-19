"""Central configuration for the transcript + WHOOP coaching toolkit.

Everything that you might reasonably want to tweak lives here so the other
scripts stay clean. Paths are relative to this `coach/` folder.
"""
from __future__ import annotations

import os
from pathlib import Path

# --- Channels to pull -------------------------------------------------------
# Add/remove channels freely. `slug` is used for folder names on disk.
CHANNELS = [
    {"slug": "hubermanlab", "url": "https://www.youtube.com/@hubermanlab/videos"},
    {"slug": "bryanjohnson", "url": "https://www.youtube.com/@bryanjohnson/videos"},
]

# --- Languages --------------------------------------------------------------
# Preference order. We try manual captions first, then auto-generated, then
# translate whatever exists into the first language below.
PREFERRED_LANGS = ["en", "en-US", "en-GB"]

# --- Paths ------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"      # data/transcripts/<slug>/<video_id>.json|.txt
MANIFEST_DIR = DATA_DIR / "manifests"           # data/manifests/<slug>.jsonl
INDEX_PATH = DATA_DIR / "index.pkl"             # BM25 search index
WHOOP_DIR = DATA_DIR / "whoop"                  # drop your WHOOP CSV exports here
WHOOP_SUMMARY_PATH = DATA_DIR / "whoop_summary.json"
WHOOP_TOKENS_PATH = DATA_DIR / "whoop_tokens.json"   # OAuth tokens (git-ignored)
COACH_PROMPT_PATH = BASE_DIR / "coach_prompt.md"

# --- Politeness / anti-block knobs -----------------------------------------
# Random sleep between transcript fetches (seconds). YouTube rate-limits hard
# when you hammer it; a little jitter keeps you under the radar.
SLEEP_MIN = 1.0
SLEEP_MAX = 3.0
# When YouTube starts blocking (429 / "request blocked"), back off this long.
BLOCK_COOLDOWN = 120.0
MAX_RETRIES = 4


def ensure_dirs() -> None:
    for d in (DATA_DIR, TRANSCRIPTS_DIR, MANIFEST_DIR, WHOOP_DIR):
        d.mkdir(parents=True, exist_ok=True)


def proxy_config():
    """Optional proxy support, read from env vars.

    If your home IP eventually gets rate-limited after pulling hundreds of
    videos, route through a proxy:

      Webshare residential (recommended by youtube-transcript-api):
        export WEBSHARE_PROXY_USERNAME=...
        export WEBSHARE_PROXY_PASSWORD=...

      Or any generic http/https proxy:
        export YT_HTTP_PROXY=http://user:pass@host:port
        export YT_HTTPS_PROXY=http://user:pass@host:port

    Returns a ProxyConfig or None.
    """
    ws_user = os.environ.get("WEBSHARE_PROXY_USERNAME")
    ws_pass = os.environ.get("WEBSHARE_PROXY_PASSWORD")
    if ws_user and ws_pass:
        from youtube_transcript_api.proxies import WebshareProxyConfig
        return WebshareProxyConfig(proxy_username=ws_user, proxy_password=ws_pass)

    http_p = os.environ.get("YT_HTTP_PROXY")
    https_p = os.environ.get("YT_HTTPS_PROXY")
    if http_p or https_p:
        from youtube_transcript_api.proxies import GenericProxyConfig
        return GenericProxyConfig(http_url=http_p, https_url=https_p)

    return None
