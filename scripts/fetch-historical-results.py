#!/usr/bin/env python3
"""
D1 results, one season at a time, from ESPN's scoreboard.

The importer only reads the current campaign, which is why Elo and standings stop at 2026.
This sweeps the regular season window for earlier years and writes:

  public/history-results.json   { "2025": [{date, home, away, hs, as}], ... }

It is deliberately separate from the main import: it takes minutes and the data changes
once a year.

Usage: python3 scripts/fetch-historical-results.py [seasons...]
"""
import json, os, sys, time, urllib.request
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "history-results.json")
API = "https://site.api.espn.com/apis/site/v2/sports/lacrosse/mens-college-lacrosse/scoreboard"
UA = "laxdb/1.0 (research; contact: laxdb)"
SEASONS = [int(s) for s in sys.argv[1:]] or [2025, 2024, 2023]
WINDOW = ((2, 1), (6, 10))  # February 1 → June 10


def fetch_day(day):
    url = f"{API}?dates={day.strftime('%Y%m%d')}&limit=200"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8", "ignore"))
    except Exception:
        return None


def games_for(day):
    payload = fetch_day(day)
    if not payload:
        return []
    out = []
    for ev in payload.get("events", []):
        comp = (ev.get("competitions") or [{}])[0]
        sides = comp.get("competitors") or []
        if len(sides) != 2:
            continue
        home = next((s for s in sides if s.get("homeAway") == "home"), sides[0])
        away = next((s for s in sides if s.get("homeAway") == "away"), sides[1])
        try:
            hs, as_ = int(home["score"]), int(away["score"])
        except (KeyError, TypeError, ValueError):
            continue
        name = lambda s: (s.get("team") or {}).get("displayName", "")
        if not name(home) or not name(away):
            continue
        out.append({"date": day.isoformat(), "home": name(home), "away": name(away),
                    "hs": hs, "as": as_})
    return out


def main():
    existing = {}
    if os.path.exists(OUT):
        try:
            existing = json.load(open(OUT))
        except Exception:
            existing = {}

    for season in SEASONS:
        start = date(season, *WINDOW[0])
        end = date(season, *WINDOW[1])
        games, day = [], start
        while day <= end:
            games.extend(games_for(day))
            day += timedelta(days=1)
            time.sleep(0.12)
        if games:
            existing[str(season)] = games
            print(f"  + {season}: {len(games)} games")
        else:
            print(f"  ! {season}: nothing returned")

    with open(OUT, "w") as f:
        json.dump(existing, f, separators=(",", ":"))
    size = os.path.getsize(OUT) / 1024
    print(f"wrote {OUT}: {sum(len(v) for v in existing.values())} games across "
          f"{len(existing)} seasons, {size:.0f} KB")


if __name__ == "__main__":
    main()
