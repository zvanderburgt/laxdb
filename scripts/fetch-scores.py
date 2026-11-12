#!/usr/bin/env python3
"""
Final scores for the site's scores page.

Two sources, one file:
  · NCAA D1 — ESPN's scoreboard, swept day by day (same endpoint the standings use)
  · PLL     — the league's own /api/v4/games, which returns scores, dates and venues

Writes public/scores.json:
  { "d1": [{date, home, away, hs, as}], "pll": [{date, home, away, hs, as, venue}] }

Usage: python3 scripts/fetch-scores.py [--seasons 2026 2025]
"""
import json, os, sys, time, urllib.request
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "scores.json")
ESPN = "https://site.api.espn.com/apis/site/v2/sports/lacrosse/mens-college-lacrosse/scoreboard"
PLL = "https://stats.premierlacrosseleague.com/api/v4/games"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
WINDOW = ((2, 1), (6, 10))

args = sys.argv[1:]
seasons = [int(a) for a in args if a.isdigit()] or [2026]


def get(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def d1_day(day):
    try:
        payload = get(f"{ESPN}?dates={day.strftime('%Y%m%d')}&limit=200")
    except Exception:
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
        out.append({"date": day.isoformat(), "home": name(home), "away": name(away), "hs": hs, "as": as_})
    return out


def d1_season(season):
    games, day = [], date(season, *WINDOW[0])
    while day <= date(season, *WINDOW[1]):
        games.extend(d1_day(day))
        day += timedelta(days=1)
        time.sleep(0.08)
    return games


def pll_season(season):
    headers = {"referer": "https://stats.premierlacrosseleague.com/", "origin": "https://stats.premierlacrosseleague.com"}
    try:
        payload = get(f"{PLL}?year={season}", headers)
    except Exception as e:
        print(f"  ! PLL {season}: {e}")
        return []
    out = []
    for g in payload.get("data", {}).get("items", []):
        home = (g.get("homeTeam") or {}).get("fullName") or (g.get("homeTeam") or {}).get("name")
        away = (g.get("awayTeam") or {}).get("fullName") or (g.get("awayTeam") or {}).get("name")
        hs, as_ = g.get("homeScore"), g.get("visitorScore")
        if not home or not away or hs is None or as_ is None:
            continue
        try:
            ts = int(g.get("startTime") or 0)
        except (TypeError, ValueError):
            ts = 0
        out.append({
            "date": time.strftime("%Y-%m-%d", time.gmtime(ts)) if ts else "",
            "home": home, "away": away, "hs": int(hs), "as": int(as_), "venue": g.get("venue") or "",
        })
    return out


def main():
    existing = {"d1": [], "pll": []}
    if os.path.exists(OUT):
        try:
            existing = json.load(open(OUT))
        except Exception:
            pass

    d1 = {(g["date"], g["home"], g["away"]): g for g in existing.get("d1", [])}
    pll = {(g["date"], g["home"], g["away"]): g for g in existing.get("pll", [])}

    for season in seasons:
        games = d1_season(season)
        for g in games:
            d1[(g["date"], g["home"], g["away"])] = g
        print(f"  + D1 {season}: {len(games)} games")
        pg = pll_season(season)
        for g in pg:
            pll[(g["date"], g["home"], g["away"])] = g
        print(f"  + PLL {season}: {len(pg)} games")

    payload = {
        "d1": sorted(d1.values(), key=lambda g: g["date"]),
        "pll": sorted(pll.values(), key=lambda g: g["date"]),
    }
    with open(OUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"wrote {OUT}: {len(payload['d1'])} D1 games, {len(payload['pll'])} PLL games, "
          f"{os.path.getsize(OUT)/1024:.0f} KB")


if __name__ == "__main__":
    main()
