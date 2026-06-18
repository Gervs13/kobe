#!/usr/bin/env python3
"""Load and summarize a WHOOP CSV export (stdlib only — no pandas needed).

How to get the data:
  WHOOP app -> More -> App Settings -> Data Export -> "Create Export".
  You'll receive a zip with files like:
      physiological_cycles.csv   (recovery %, HRV, resting HR, day strain, sleep)
      sleeps.csv
      workouts.csv
      journal_entries.csv
  Unzip it into  coach/data/whoop/  (any subfolder layout is fine).

This parser is deliberately tolerant: WHOOP renames columns over time, so we
match columns by keyword rather than exact name. It produces:
  - a human-readable summary (printed / fed to the coach prompt)
  - data/whoop_summary.json  (structured, for make_coach_prompt.py)

Usage:  python whoop.py
"""
from __future__ import annotations

import csv
import glob
import json
import statistics
import sys
from datetime import datetime, timedelta

import config

# metric name -> list of keyword sets that identify its column (all words must appear)
METRIC_KEYWORDS = {
    "recovery":          [["recovery", "score"]],
    "hrv":               [["heart", "rate", "variability"], ["hrv"]],
    "resting_hr":        [["resting", "heart", "rate"], ["resting", "hr"]],
    "day_strain":        [["day", "strain"], ["strain"]],
    "sleep_performance": [["sleep", "performance"]],
    "sleep_efficiency":  [["sleep", "efficiency"]],
    "sleep_hours":       [["asleep", "duration"], ["hours", "of", "sleep"]],
    "rem_min":           [["rem", "duration"]],
    "deep_min":          [["deep", "duration"], ["sws", "duration"]],
    "respiratory_rate":  [["respiratory", "rate"]],
    "sleep_debt_min":    [["sleep", "debt"]],
}

DATE_KEYWORDS = [["cycle", "start"], ["sleep", "onset"], ["start", "time"],
                 ["date"], ["created"]]


def _match_column(headers: list[str], keyword_sets: list[list[str]]) -> str | None:
    low = {h: h.lower() for h in headers}
    for kw in keyword_sets:
        for h, hl in low.items():
            if all(w in hl for w in kw):
                return h
    return None


def _parse_float(val: str):
    if val is None:
        return None
    val = val.strip().replace("%", "")
    if val in ("", "NA", "N/A", "-", "null"):
        return None
    try:
        return float(val)
    except ValueError:
        return None


def _parse_date(val: str):
    if not val:
        return None
    val = val.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M",
                "%Y-%m-%d", "%m/%d/%Y %H:%M", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(val[:len(fmt) + 4], fmt)
        except ValueError:
            continue
    # try fromisoformat as a last resort (handles offsets)
    try:
        return datetime.fromisoformat(val.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:  # noqa: BLE001
        return None


def _find_csvs() -> list[str]:
    return sorted(glob.glob(str(config.WHOOP_DIR / "**" / "*.csv"), recursive=True))


def load_rows() -> list[dict]:
    """Read every WHOOP CSV, normalizing into {date, metric: value} rows."""
    rows: list[dict] = []
    files = _find_csvs()
    if not files:
        return rows
    for path in files:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            headers = reader.fieldnames or []
            date_col = _match_column(headers, DATE_KEYWORDS)
            metric_cols = {m: _match_column(headers, kws)
                           for m, kws in METRIC_KEYWORDS.items()}
            metric_cols = {m: c for m, c in metric_cols.items() if c}
            if not metric_cols:
                continue
            for raw in reader:
                rec = {"date": _parse_date(raw.get(date_col, "")) if date_col else None,
                       "_source": path.split("/")[-1]}
                for m, col in metric_cols.items():
                    v = _parse_float(raw.get(col, ""))
                    if v is not None:
                        rec[m] = v
                if any(m in rec for m in METRIC_KEYWORDS):
                    rows.append(rec)
    return rows


def _window_stats(rows: list[dict], metric: str, days: int, now: datetime):
    cutoff = now - timedelta(days=days)
    vals = [r[metric] for r in rows
            if metric in r and r.get("date") and r["date"] >= cutoff]
    if not vals:
        return None
    return {"avg": round(statistics.mean(vals), 1),
            "min": round(min(vals), 1), "max": round(max(vals), 1), "n": len(vals)}


def summarize(rows: list[dict]) -> dict:
    dated = [r for r in rows if r.get("date")]
    now = max((r["date"] for r in dated), default=datetime.now())
    summary = {"as_of": now.strftime("%Y-%m-%d"), "metrics": {}, "flags": []}

    for metric in METRIC_KEYWORDS:
        present = [r[metric] for r in rows if metric in r]
        if not present:
            continue
        latest = next((r[metric] for r in sorted(dated, key=lambda r: r["date"], reverse=True)
                       if metric in r), None)
        summary["metrics"][metric] = {
            "latest": round(latest, 1) if latest is not None else None,
            "last_7d": _window_stats(rows, metric, 7, now),
            "last_30d": _window_stats(rows, metric, 30, now),
        }

    _add_flags(summary)
    return summary


def _add_flags(summary: dict) -> None:
    """Plain-language signals the coach should react to."""
    m = summary["metrics"]

    def avg7(name):
        d = m.get(name, {}).get("last_7d")
        return d["avg"] if d else None

    rec, hrv, rhr = avg7("recovery"), avg7("hrv"), avg7("resting_hr")
    slp, strain = avg7("sleep_performance"), avg7("day_strain")
    debt = avg7("sleep_debt_min")

    if rec is not None and rec < 50:
        summary["flags"].append(f"Low 7-day recovery ({rec}%) — body is under-recovered.")
    if slp is not None and slp < 70:
        summary["flags"].append(f"Sleep performance averaging {slp}% — under sleep need.")
    if debt is not None and debt > 60:
        summary["flags"].append(f"Accumulating sleep debt (~{debt} min/night).")
    if rec is not None and strain is not None and rec < 50 and strain > 14:
        summary["flags"].append(
            f"High strain ({strain}) on low recovery ({rec}%) — overreaching risk.")
    # trend note on HRV: compare 7d vs 30d
    hrv30 = m.get("hrv", {}).get("last_30d")
    if hrv is not None and hrv30 and hrv < hrv30["avg"] * 0.9:
        summary["flags"].append(
            f"HRV trending down (7d {hrv} vs 30d {hrv30['avg']} ms).")
    if not summary["flags"]:
        summary["flags"].append("No acute red flags in the recent window.")


def to_text(summary: dict) -> str:
    lines = [f"WHOOP summary (as of {summary['as_of']}):", ""]
    label = {
        "recovery": "Recovery", "hrv": "HRV (ms)", "resting_hr": "Resting HR (bpm)",
        "day_strain": "Day strain", "sleep_performance": "Sleep performance %",
        "sleep_efficiency": "Sleep efficiency %", "sleep_hours": "Asleep (min)",
        "rem_min": "REM (min)", "deep_min": "Deep sleep (min)",
        "respiratory_rate": "Respiratory rate", "sleep_debt_min": "Sleep debt (min)",
    }
    for metric, data in summary["metrics"].items():
        d7 = data["last_7d"]
        seg = f"  {label.get(metric, metric):<22} latest {data['latest']}"
        if d7:
            seg += f"   |  7-day avg {d7['avg']} (n={d7['n']})"
        lines.append(seg)
    lines += ["", "Flags:"]
    lines += [f"  • {f}" for f in summary["flags"]]
    return "\n".join(lines)


def main() -> None:
    config.ensure_dirs()
    rows = load_rows()
    if not rows:
        print(f"No WHOOP CSVs found in {config.WHOOP_DIR}.")
        print("Export from the WHOOP app and unzip the CSVs into that folder, then re-run.")
        sys.exit(1)
    summary = summarize(rows)
    config.WHOOP_SUMMARY_PATH.write_text(json.dumps(summary, indent=2))
    print(to_text(summary))
    print(f"\nWrote {config.WHOOP_SUMMARY_PATH}")
    print("Next:  python make_coach_prompt.py")


if __name__ == "__main__":
    main()
