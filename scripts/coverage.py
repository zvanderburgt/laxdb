#!/usr/bin/env python3
"""Field-level coverage report for the shipped dataset.

Answers "what are we missing, and where" per competition, so a scraping pass can
target the actual hole instead of re-crawling everything.

  python3 scripts/coverage.py              # per-league table
  python3 scripts/coverage.py --field dob  # who is missing a field, by league
  python3 scripts/coverage.py --json       # machine-readable
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")

# field -> how to read it off a player record
FIELDS = {
    "photo": lambda p: bool(p.get("photo")),
    "dob": lambda p: bool(p.get("dob")),
    "hometown": lambda p: bool((p.get("birthplace") or {}).get("city")),
    "province/state": lambda p: bool((p.get("birthplace") or {}).get("state")),
    "country": lambda p: bool((p.get("birthplace") or {}).get("country")),
    "height": lambda p: (p.get("heightIn") or 0) > 0,
    "weight": lambda p: (p.get("weightLb") or 0) > 0,
    "hand": lambda p: bool(p.get("hand")),
    "jersey": lambda p: (p.get("jersey") or 0) > 0,
    "high school": lambda p: bool(p.get("highSchool")),
    "class year": lambda p: bool(p.get("classYear")),
}


def load():
    with open(DATA) as f:
        return json.load(f)


def report(dataset, as_json=False):
    players = dataset["players"]
    teams = dataset["teams"]
    leagues = {l["id"]: l for l in dataset["leagues"]}

    per_league = defaultdict(list)
    for p in players:
        per_league[p["leagueId"]].append(p)

    rows = []
    for lid, group in sorted(per_league.items(), key=lambda kv: -len(kv[1])):
        total = len(group)
        row = {"league": lid, "name": leagues.get(lid, {}).get("name", lid), "players": total}
        for field, test in FIELDS.items():
            n = sum(1 for p in group if test(p))
            row[field] = {"n": n, "pct": round(100 * n / total) if total else 0}
        rows.append(row)

    team_logos = Counter()
    team_totals = Counter()
    for t in teams:
        team_totals[t["leagueId"]] += 1
        if t.get("logo"):
            team_logos[t["leagueId"]] += 1
    for row in rows:
        lid = row["league"]
        row["team logos"] = {
            "n": team_logos[lid],
            "pct": round(100 * team_logos[lid] / team_totals[lid]) if team_totals[lid] else 0,
        }

    if as_json:
        print(json.dumps(rows, indent=1))
        return rows

    cols = list(FIELDS.keys()) + ["team logos"]
    head = f"{'league':<26}{'players':>8}" + "".join(f"{c[:9]:>10}" for c in cols)
    print(head)
    print("-" * len(head))
    for row in rows:
        line = f"{row['league']:<26}{row['players']:>8}"
        for c in cols:
            line += f"{row[c]['pct']:>9}%"
        print(line)

    print()
    totals = {c: sum(r[c]["n"] for r in rows) for c in cols}
    n = sum(r["players"] for r in rows)
    print("overall: " + "  ".join(f"{c} {round(100 * totals[c] / n)}%" for c in cols))
    return rows


def missing(dataset, field):
    """Print who is missing `field`, grouped by league, with a sample."""
    test = FIELDS[field]
    by_league = defaultdict(list)
    for p in dataset["players"]:
        if not test(p):
            by_league[p["leagueId"]].append(p)
    for lid, group in sorted(by_league.items(), key=lambda kv: -len(kv[1])):
        print(f"{lid:<26}{len(group):>7} missing   e.g. " + ", ".join(p["name"] for p in group[:4]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--field", choices=sorted(FIELDS), help="list everyone missing this field")
    args = ap.parse_args()
    dataset = load()
    if args.field:
        missing(dataset, args.field)
    else:
        report(dataset, as_json=args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
