#!/usr/bin/env python3
"""
Attach earlier seasons' records to teams in public/data.json.

Reads public/history-results.json (scripts/fetch-historical-results.py) and writes a
`history` array on each D1 team: final regular-season W-L and goals for/against per year.
Merged in place so it does not need a full re-import.

Usage: python3 scripts/attach-history.py
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
RESULTS = os.path.join(ROOT, "public", "history-results.json")


def norm_team(raw):
    s = re.sub(r"[^a-z0-9]+", "", (raw or "").lower())
    for suffix in ("university", "college", "mens", "lacrosse"):
        s = s.replace(suffix, "")
    return s


def main():
    if not os.path.exists(RESULTS):
        sys.exit("no public/history-results.json — run scripts/fetch-historical-results.py")
    seasons = json.load(open(RESULTS))
    data = json.load(open(DATA))

    # index our D1 teams by a few aliases so "North Carolina" matches "North Carolina Tar Heels"
    teams = [t for t in data["teams"] if t["leagueId"] == "ncaa-d1"]
    by_alias = {}
    for t in teams:
        for alias in {norm_team(t["name"]), norm_team(t["shortName"]), norm_team(t["slug"])}:
            if alias:
                by_alias.setdefault(alias, t)

    def resolve(name):
        key = norm_team(name)
        if key in by_alias:
            return by_alias[key]
        for alias, team in by_alias.items():
            if alias.startswith(key) or key.startswith(alias):
                return team
        return None

    # ESPN returns only a slice of the 2023/2024 schedules (median 4-5 games per team vs
    # 15 for 2025), so only seasons that look complete are attached
    import statistics
    complete = {}
    for season, games in seasons.items():
        counts = {}
        for g in games:
            counts[g["home"]] = counts.get(g["home"], 0) + 1
            counts[g["away"]] = counts.get(g["away"], 0) + 1
        if counts and statistics.median(counts.values()) >= 12:
            complete[season] = games
        else:
            print(f"  skipping {season}: median {statistics.median(counts.values()):.0f} games/team")

    totals = {}
    for season, games in complete.items():
        for g in games:
            for side, opp, gf, ga in ((g["home"], g["away"], g["hs"], g["as"]),
                                      (g["away"], g["home"], g["as"], g["hs"])):
                team = resolve(side)
                if not team:
                    continue
                key = (team["id"], season)
                row = totals.setdefault(key, {"w": 0, "l": 0, "gf": 0, "ga": 0})
                row["gf"] += gf
                row["ga"] += ga
                if gf > ga:
                    row["w"] += 1
                elif gf < ga:
                    row["l"] += 1

    for t in teams:
        t.pop("history", None)
    for (team_id, season), row in sorted(totals.items()):
        team = next((t for t in teams if t["id"] == team_id), None)
        if not team or row["w"] + row["l"] == 0:
            continue
        team.setdefault("history", []).append({"season": season, **row})

    for t in teams:
        if "history" in t:
            t["history"].sort(key=lambda r: r["season"], reverse=True)

    with open(DATA, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    with_hist = sum(1 for t in teams if t.get("history"))
    print(f"attached history to {with_hist} of {len(teams)} D1 teams")


if __name__ == "__main__":
    main()
