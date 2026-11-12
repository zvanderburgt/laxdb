#!/usr/bin/env python3
"""Field-level coverage report for the shipped dataset.

Answers "what are we missing, and where" per competition, so a scraping pass can
target the actual hole instead of re-crawling everything.

  python3 scripts/coverage.py                 # per-league table + ranking
  python3 scripts/coverage.py --json          # machine-readable
  python3 scripts/coverage.py --field dob     # who is missing a field, by league
  python3 scripts/coverage.py --field dob --teams   # and which clubs they sit on

`core` is the six facts every provider publishes somewhere, so a league with a low core
score is a real gap rather than a field nobody collects:
photo, dob, hometown, height, weight, jersey.

`hand` is printed but excluded from core: no source we hold publishes handedness, so 0%
everywhere means "not available", not "not fetched".
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
GAMES = os.path.join(ROOT, "public", "games.json")
SCORES = os.path.join(ROOT, "public", "scores.json")

FIELDS = {
    "photo": lambda p: bool(p.get("photo")),
    "dob": lambda p: bool(p.get("dob")),
    "hometown": lambda p: bool((p.get("birthplace") or {}).get("city")),
    "province/state": lambda p: bool((p.get("birthplace") or {}).get("state")),
    "country": lambda p: bool((p.get("birthplace") or {}).get("country")),
    "height": lambda p: (p.get("heightIn") or 0) > 0,
    "weight": lambda p: (p.get("weightLb") or 0) > 0,
    "jersey": lambda p: (p.get("jersey") or 0) > 0,
    "high school": lambda p: bool(p.get("highSchool")),
    "class year": lambda p: bool(p.get("classYear")),
    "hand": lambda p: bool(p.get("hand")),
}

CORE = ["photo", "dob", "hometown", "height", "weight", "jersey"]
LABEL = {
    "photo": "photo", "dob": "dob", "hometown": "hometown", "province/state": "prov",
    "country": "country", "height": "height", "weight": "weight", "jersey": "jersey",
    "high school": "h.school", "class year": "class", "hand": "hand",
}
SCORED_LEAGUES = {"ncaa-d1": "d1", "pll": "pll"}


def load():
    with open(DATA) as f:
        dataset = json.load(f)
    games = {}
    if os.path.exists(GAMES):
        with open(GAMES) as f:
            games = json.load(f)
    scores = {}
    if os.path.exists(SCORES):
        with open(SCORES) as f:
            scores = json.load(f)
    return dataset, games, scores


def pct(n: int, d: int) -> float:
    return (100.0 * n / d) if d else 0.0


def collect(dataset, games, scores):
    per_league = defaultdict(list)
    for p in dataset["players"]:
        per_league[p["leagueId"]].append(p)
    teams = defaultdict(list)
    for t in dataset["teams"]:
        teams[t["leagueId"]].append(t)

    rows = []
    for league in dataset["leagues"]:
        lid = league["id"]
        ps = per_league.get(lid, [])
        ts = teams.get(lid, [])
        filled = {f: sum(1 for p in ps if test(p)) for f, test in FIELDS.items()}
        row = {
            "id": lid,
            "name": league["name"],
            "players": len(ps),
            "teams": len(ts),
            "seasons": sum(len(p.get("seasons") or []) for p in ps),
            "filled": filled,
            "logos": sum(1 for t in ts if t.get("logo")),
            "staff": sum(1 for t in ts if t.get("staff")),
            "gamelogs": sum(1 for p in ps if games.get(p["id"])),
            "scores": len(scores.get(SCORED_LEAGUES[lid], [])) if lid in SCORED_LEAGUES else None,
        }
        row["core"] = sum(pct(filled[f], len(ps)) for f in CORE) / len(CORE) if ps else 0.0
        # a player with none of these is a name and a stat line with no person behind it
        row["no_bio"] = sum(
            1 for p in ps
            if not any((p.get("photo"), p.get("dob"), (p.get("birthplace") or {}).get("city"),
                        p.get("heightIn"), p.get("weightLb")))
        )
        rows.append(row)
    return rows


def print_table(rows):
    head = (f"{'league':<26}{'players':>8}{'teams':>7}{'logs':>7}"
            + "".join(f"{LABEL[f]:>9}" for f in CORE)
            + f"{'core':>7}{'no bio':>8}{'logo':>6}{'staff':>6}")
    print(head)
    print("-" * len(head))
    for r in sorted(rows, key=lambda r: -r["players"]):
        line = f"{r['id']:<26}{r['players']:>8}{r['teams']:>7}{r['gamelogs']:>7}"
        for f in CORE:
            line += f"{pct(r['filled'][f], r['players']):>8.0f}%"
        line += (f"{r['core']:>6.0f}%{r['no_bio']:>8,}{pct(r['logos'], r['teams']):>5.0f}%"
                 f"{pct(r['staff'], r['teams']):>5.0f}%")
        print(line)


def print_summary(rows):
    total = sum(r["players"] for r in rows)
    print(f"\n{total:,} players · {sum(r['teams'] for r in rows)} clubs · "
          f"{sum(r['seasons'] for r in rows):,} player-seasons across {len(rows)} leagues\n")

    print("MISSING MOST, across the dataset")
    print(f"  {'field':<15}{'missing':>9}{'share':>7}   {'a source publishes it':>23}")
    holes = []
    for f in FIELDS:
        missing = sum(r["players"] - r["filled"][f] for r in rows)
        best = max((pct(r["filled"][f], r["players"]) for r in rows), default=0)
        holes.append((missing, f, best))
    for missing, f, best in sorted(holes, reverse=True):
        note = "yes" if best >= 5 else "NO - field source missing"
        print(f"  {f:<15}{missing:>9,}{100.0 * missing / total:>6.0f}%   {note:>23}")

    print("\nWHICH LEAGUE IS MISSING THE MOST (worst core score first, 100+ players)")
    print(f"  {'league':<26}{'players':>8}{'core':>7}   weakest fields")
    for r in sorted(rows, key=lambda r: (r["core"], -r["players"])):
        if r["players"] < 100:
            continue
        weak = sorted(CORE, key=lambda f: r["filled"][f] / r["players"])[:3]
        detail = ", ".join(f"{f} {pct(r['filled'][f], r['players']):.0f}%" for f in weak)
        print(f"  {r['id']:<26}{r['players']:>8}{r['core']:>6.0f}%   {detail}")

    print("\nWHERE THOSE PLAYERS SIT (field -> leagues holding the gap)")
    for f in sorted(CORE, key=lambda f: -sum(r["players"] - r["filled"][f] for r in rows)):
        gaps = sorted(((r["players"] - r["filled"][f], r["id"]) for r in rows), reverse=True)[:3]
        total_missing = sum(r["players"] - r["filled"][f] for r in rows)
        print(f"  {f:<10}{total_missing:>8,}   " + ", ".join(f"{lid} {n:,}" for n, lid in gaps if n))

    blank = sum(r["no_bio"] for r in rows)
    print(f"\nEMPTY PROFILES")
    print(f"  {blank:,} of {total:,} players ({pct(blank, total):.0f}%) have no photo, birth date,"
          f" hometown, height or weight")
    for n, lid in sorted(((r["no_bio"], r["id"]) for r in rows), reverse=True)[:5]:
        print(f"    {lid:<26}{n:>7,}")

    print("\nTEAM ASSETS")
    all_teams = sum(r["teams"] for r in rows)
    for label, key in (("logos", "logos"), ("staff", "staff")):
        missing = sum(r["teams"] - r[key] for r in rows)
        print(f"  {label:<8}{missing:>7,} missing of {all_teams:,} ({pct(missing, all_teams):.0f}%)")

    logged = sum(r["gamelogs"] for r in rows)
    print(f"  {'game log':<8}{total - logged:>7,} players without one "
          f"({pct(logged, total):.0f}% covered)")


def missing(dataset, field, by_team=False):
    """Print who is missing `field`, grouped by league, optionally by club."""
    test = FIELDS[field]
    groups = defaultdict(list)
    for p in dataset["players"]:
        if not test(p):
            groups[p["leagueId"]].append(p)
    for lid, group in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        print(f"{lid:<26}{len(group):>7} missing   e.g. " + ", ".join(p["name"] for p in group[:4]))
    if by_team:
        names = {t["id"]: t for t in dataset["teams"]}
        clubs = Counter(p["teamId"] for group in groups.values() for p in group)
        print()
        for tid, n in clubs.most_common(40):
            club = names.get(tid) or {}
            print(f"  {club.get('name', tid)[:44]:<46}{n:>5}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--field", choices=sorted(FIELDS), help="list everyone missing this field")
    ap.add_argument("--teams", action="store_true", help="with --field, break down by club")
    ap.add_argument("--save", action="store_true", help="append this run to docs/coverage-history.json")
    args = ap.parse_args()

    dataset, games, scores = load()
    if args.field:
        missing(dataset, args.field, by_team=args.teams)
        return 0

    rows = collect(dataset, games, scores)
    if args.save:
        import datetime
        hist_path = os.path.join(ROOT, "docs", "coverage-history.json")
        history = []
        if os.path.exists(hist_path):
            with open(hist_path) as f:
                history = json.load(f)
        history.append({
            "date": datetime.date.today().isoformat(),
            "players": sum(r["players"] for r in rows),
            "leagues": {r["id"]: {"players": r["players"], "core": round(r["core"], 1),
                                  "no_bio": r["no_bio"]} for r in rows},
        })
        with open(hist_path, "w") as f:
            json.dump(history, f, indent=1)
        print(f"saved snapshot -> {hist_path} ({len(history)} runs)")
    if args.json:
        json.dump(rows, sys.stdout, indent=1)
        print()
        return 0
    print_table(rows)
    print_summary(rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
