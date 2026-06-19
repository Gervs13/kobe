#!/usr/bin/env python3
"""Pull your WHOOP data live via the WHOOP API (OAuth 2.0) — no CSV export needed.

This is the live alternative to whoop.py. It logs you into WHOOP in your browser,
captures the OAuth redirect on localhost, stores a refresh token, fetches your
recovery / cycle (strain) / sleep records, and writes the SAME
data/whoop_summary.json the coach reads — so chat.py and make_coach_prompt.py
work unchanged afterward.

Stdlib only. Run on your own machine (the WHOOP API blocks datacenter IPs, and
OAuth needs your browser regardless).

--- ONE-TIME SETUP ------------------------------------------------------------
1. Create a WHOOP app at  https://developer-dashboard.whoop.com/
2. Add this Redirect URL to the app, EXACTLY:
       http://localhost:8080/callback
3. Give the app these scopes:
       read:recovery  read:cycles  read:sleep  read:workout
       read:profile   read:body_measurement   offline
4. Put the app's credentials in your environment:
       export WHOOP_CLIENT_ID=...
       export WHOOP_CLIENT_SECRET=...

--- RUN -----------------------------------------------------------------------
    python whoop_api.py            # last 90 days → whoop_summary.json
    python whoop_api.py --days 30
    python whoop_api.py --reauth   # force a fresh browser login
Then:
    python make_coach_prompt.py    # or: python chat.py
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

import config
import whoop

AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
API_BASE = "https://api.prod.whoop.com/developer"
REDIRECT_URI = "http://localhost:8080/callback"
SCOPES = ["offline", "read:recovery", "read:cycles", "read:sleep",
          "read:workout", "read:profile", "read:body_measurement"]


# --- OAuth: capture the redirect on localhost --------------------------------
class _CallbackHandler(BaseHTTPRequestHandler):
    result: dict = {}

    def do_GET(self):  # noqa: N802
        q = urllib.parse.urlparse(self.path)
        if q.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return
        params = urllib.parse.parse_qs(q.query)
        _CallbackHandler.result = {k: v[0] for k, v in params.items()}
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        ok = "code" in _CallbackHandler.result
        msg = ("✅ WHOOP connected. You can close this tab and return to the terminal."
               if ok else "❌ Authorization failed. Check the terminal.")
        self.wfile.write(f"<html><body style='font-family:sans-serif'><h2>{msg}</h2></body></html>"
                         .encode())

    def log_message(self, *a):  # silence the default request logging
        pass


def _form_post(url: str, fields: dict) -> dict:
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"Token request failed ({e.code}): {e.read().decode()[:300]}")


def browser_authorize(client_id: str) -> dict:
    state = secrets.token_urlsafe(16)
    url = AUTH_URL + "?" + urllib.parse.urlencode({
        "response_type": "code", "client_id": client_id,
        "redirect_uri": REDIRECT_URI, "scope": " ".join(SCOPES), "state": state,
    })
    server = HTTPServer(("localhost", 8080), _CallbackHandler)
    print("Opening your browser to authorize WHOOP...")
    print(f"If it doesn't open, paste this URL:\n  {url}\n")
    webbrowser.open(url)
    server.handle_request()   # blocks until the single redirect arrives
    server.server_close()
    res = _CallbackHandler.result
    if res.get("state") != state:
        sys.exit("OAuth state mismatch — aborting for safety.")
    if "code" not in res:
        sys.exit(f"Authorization failed: {res.get('error_description', res)}")
    return res


def get_access_token(client_id: str, client_secret: str, reauth: bool) -> str:
    tokens = {}
    if config.WHOOP_TOKENS_PATH.exists() and not reauth:
        tokens = json.loads(config.WHOOP_TOKENS_PATH.read_text())

    if tokens.get("refresh_token"):
        data = _form_post(TOKEN_URL, {
            "grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
            "client_id": client_id, "client_secret": client_secret,
            "scope": "offline",
        })
    else:
        code = browser_authorize(client_id)["code"]
        data = _form_post(TOKEN_URL, {
            "grant_type": "authorization_code", "code": code,
            "client_id": client_id, "client_secret": client_secret,
            "redirect_uri": REDIRECT_URI,
        })

    if "access_token" not in data:
        sys.exit(f"No access token in response: {data}")
    # persist rotating refresh token
    config.WHOOP_TOKENS_PATH.write_text(json.dumps({
        "refresh_token": data.get("refresh_token", tokens.get("refresh_token")),
    }))
    return data["access_token"]


# --- API fetch ---------------------------------------------------------------
def _api_get(path: str, token: str, params: dict) -> dict:
    url = f"{API_BASE}{path}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"WHOOP API {path} failed ({e.code}): {e.read().decode()[:300]}")


def fetch_collection(path: str, token: str, start: str, end: str) -> list[dict]:
    records, next_token = [], None
    while True:
        params = {"start": start, "end": end, "limit": 25}
        if next_token:
            params["nextToken"] = next_token
        page = _api_get(path, token, params)
        records.extend(page.get("records", []))
        next_token = page.get("next_token")
        if not next_token:
            return records


# --- Normalize WHOOP JSON → rows for whoop.summarize -------------------------
def _parse_iso(s: str | None):
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _ms_to_min(v):
    return round(v / 60000, 1) if v is not None else None


def normalize(recoveries: list, cycles: list, sleeps: list) -> list[dict]:
    """Build whoop.py-compatible rows from WHOOP API records."""
    rows: list[dict] = []

    for r in recoveries:
        if r.get("score_state") != "SCORED":
            continue
        sc = r.get("score") or {}
        rows.append({"date": _parse_iso(r.get("created_at")),
                     "recovery": sc.get("recovery_score"),
                     "hrv": sc.get("hrv_rmssd_milli"),
                     "resting_hr": sc.get("resting_heart_rate")})

    for c in cycles:
        if c.get("score_state") != "SCORED":
            continue
        sc = c.get("score") or {}
        rows.append({"date": _parse_iso(c.get("start")),
                     "day_strain": sc.get("strain")})

    for s in sleeps:
        if s.get("score_state") != "SCORED":
            continue
        sc = s.get("score") or {}
        st = sc.get("stage_summary") or {}
        light = st.get("total_light_sleep_time_milli")
        sws = st.get("total_slow_wave_sleep_time_milli")
        rem = st.get("total_rem_sleep_time_milli")
        asleep = _ms_to_min((light or 0) + (sws or 0) + (rem or 0)) if None not in (light, sws, rem) else None
        rows.append({"date": _parse_iso(s.get("end") or s.get("start")),
                     "sleep_performance": sc.get("sleep_performance_percentage"),
                     "sleep_efficiency": sc.get("sleep_efficiency_percentage"),
                     "respiratory_rate": sc.get("respiratory_rate"),
                     "sleep_hours": asleep,
                     "rem_min": _ms_to_min(rem),
                     "deep_min": _ms_to_min(sws)})

    # drop keys whose value is None so summarize() ignores missing metrics
    return [{k: v for k, v in row.items() if v is not None} for row in rows]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=90, help="how many days back to pull")
    ap.add_argument("--reauth", action="store_true", help="force a fresh browser login")
    args = ap.parse_args()

    client_id = os.environ.get("WHOOP_CLIENT_ID")
    client_secret = os.environ.get("WHOOP_CLIENT_SECRET")
    if not client_id or not client_secret:
        sys.exit("Set WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET (see the setup notes "
                 "at the top of this file).")

    config.ensure_dirs()
    token = get_access_token(client_id, client_secret, args.reauth)

    end = dt.datetime.utcnow()
    start = end - dt.timedelta(days=args.days)
    fmt = lambda d: d.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    s, e = fmt(start), fmt(end)

    print(f"Fetching the last {args.days} days from WHOOP...")
    recoveries = fetch_collection("/v2/recovery", token, s, e)
    cycles = fetch_collection("/v2/cycle", token, s, e)
    sleeps = fetch_collection("/v2/activity/sleep", token, s, e)
    print(f"  recovery: {len(recoveries)}   cycles: {len(cycles)}   sleeps: {len(sleeps)}")

    # keep a raw copy for transparency / debugging
    (config.WHOOP_DIR / "whoop_api_raw.json").write_text(json.dumps(
        {"recovery": recoveries, "cycle": cycles, "sleep": sleeps}, indent=2))

    rows = normalize(recoveries, cycles, sleeps)
    if not rows:
        sys.exit("No SCORED records returned for that window. Try a larger --days.")
    summary = whoop.summarize(rows)
    config.WHOOP_SUMMARY_PATH.write_text(json.dumps(summary, indent=2))
    print()
    print(whoop.to_text(summary))
    print(f"\nWrote {config.WHOOP_SUMMARY_PATH}")
    print("Next:  python make_coach_prompt.py   (or: python chat.py)")


if __name__ == "__main__":
    main()
