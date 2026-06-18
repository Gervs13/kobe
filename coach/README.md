# YouTube → WHOOP Personal Coach

Pull the transcripts of **every** video from the channels you follow
(Huberman Lab + Bryan Johnson by default), index them, and turn them — together
with **your own WHOOP data** — into a ready-to-paste coaching prompt for
Claude/ChatGPT.

> ⚠️ **Run this on your own computer, not in the cloud.** YouTube blocks
> datacenter/cloud IPs (returns `403`), so the transcript fetcher only works
> from a normal home/residential connection. That's why this toolkit was
> committed to your repo for you to run locally rather than executed in the
> cloud session that created it.
>
> This is for **personal use**. You're downloading publicly-available captions
> for your own coaching. Don't redistribute the transcripts.

## What's here

| File | Does |
|---|---|
| `fetch_transcripts.py` | Lists all videos per channel (yt-dlp) and downloads each transcript. Resumable. |
| `build_index.py` | Chunks transcripts and builds a BM25 search index. |
| `search.py` | Search the index from the CLI. |
| `whoop.py` | Parse your WHOOP CSV export → a summary + flags. |
| `make_coach_prompt.py` | Combine WHOOP summary + relevant transcript excerpts → `coach_prompt.md`. |
| `coach_system_prompt.md` | The coach's persona / rules (edit to taste). |
| `config.py` | Channels, languages, paths, rate-limit knobs. |

Your data lives under `coach/data/` and is **git-ignored** (never committed).

## Setup (once)

```bash
cd coach
python3 -m venv .venv && source .venv/bin/activate   # recommended
pip install -r requirements.txt
```

## Step 1 — Download all transcripts

```bash
python fetch_transcripts.py            # all channels (takes a while: hundreds of videos)
# helpful variants:
python fetch_transcripts.py --limit 5  # smoke test first — do this once to confirm it works
python fetch_transcripts.py --channel hubermanlab
python fetch_transcripts.py --refresh  # re-list videos (catch newly published ones)
```

- **Resumable:** re-run any time; it skips videos already saved. If YouTube
  rate-limits you, just wait and run it again — progress is kept on disk.
- Saves `data/transcripts/<channel>/<video_id>.json` (timestamped) and `.txt`.
- Videos with captions disabled are logged to `_failures.jsonl` and skipped.
- Expect this to take a while and possibly span a few sessions — Huberman + Bryan
  Johnson together are ~450 videos, many multi-hour.

**If your IP gets blocked** after a lot of requests, route through a proxy
(see `config.py` → `proxy_config`):

```bash
export WEBSHARE_PROXY_USERNAME=...   # residential proxy (recommended)
export WEBSHARE_PROXY_PASSWORD=...
# or a generic proxy:
export YT_HTTPS_PROXY=http://user:pass@host:port
```

## Step 2 — Build the search index

```bash
python build_index.py
python search.py "how to improve deep sleep"     # sanity check
```

## Step 3 — Add your WHOOP data

In the WHOOP app: **More → App Settings → Data Export → Create Export**.
Unzip the CSVs into `coach/data/whoop/`, then:

```bash
python whoop.py
```

This prints your recovery/HRV/sleep/strain summary, flags red-flags, and writes
`data/whoop_summary.json`. The parser matches columns by keyword, so it survives
WHOOP renaming things.

## Step 4 — Generate your coaching prompt

```bash
python make_coach_prompt.py
# optionally steer it:
python make_coach_prompt.py --topics "caffeine timing,zone 2 cardio,cold exposure" --per-topic 3
```

This writes **`coach_prompt.md`**. Open it, copy everything, and paste it into
Claude or ChatGPT. The model now coaches you using the two channels' protocols
grounded in your actual WHOOP numbers, with citations + timestamped links.

Re-run Step 3 + Step 4 whenever you have a fresh WHOOP export (e.g. weekly).

## Refreshing later

```bash
python fetch_transcripts.py --refresh   # grab newly published videos
python build_index.py                   # rebuild index
python whoop.py && python make_coach_prompt.py   # new week's coaching
```

## Notes & limits
- Not medical advice. The coach prompt encodes guardrails, but use judgment and
  see a physician for anything clinical.
- Bryan Johnson's Blueprint is an n=1 personal experiment; the coach is told to
  present it as such rather than as established medicine.
- BM25 is keyword search (no API key, fully local). If you later want semantic
  search, the chunks in `data/index.pkl` can be embedded with any model.
