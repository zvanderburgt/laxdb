#!/usr/bin/env python3
"""
Repair the published dataset in place.

Three defects found by scripts/check-data.py:
  1. a few MCLA stat cells parse to -1/-3 (a dash or a trailing token read as a number)
  2. three clubs appear twice with the same id, once per league they play in
  3. one club is referenced by 29 seasons but has no team row (it was dropped when the
     league's standings table did not list it)

Usage: python3 scripts/repair-data.py [--dry]
"""
import json, os, re, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
GAMES = os.path.join(ROOT, "public", "games.json")
DRY = "--dry" in sys.argv
NUM = ("gp", "gs", "g", "a", "pts", "sh", "gb", "to", "ct", "foW", "foA", "pen", "min", "ga", "sv", "w", "l")


def clean_numbers(row):
    fixed = 0
    for k in NUM:
        v = row.get(k)
        if isinstance(v, (int, float)) and v < 0:
            row[k] = 0
            fixed += 1
    return fixed


def main():
    data = json.load(open(DATA))
    players, teams = data["players"], data["teams"]

    # 1. negatives
    neg = 0
    for p in players:
        for s in p["seasons"]:
            neg += clean_numbers(s)
            # no two-point goals in the college game, so points must be goals + assists
            if s["leagueId"] in ("ncaa-d1", "mcla") and (s.get("g") is not None or s.get("a") is not None):
                fixed = (s.get("g") or 0) + (s.get("a") or 0)
                if s.get("pts") != fixed:
                    s["pts"] = fixed
        if isinstance(p.get("careerLine"), dict):
            neg += clean_numbers(p["careerLine"])

    # 2. duplicate team ids (same club, two leagues)
    league_seasons = Counter()
    for p in players:
        for s in p["seasons"]:
            league_seasons[(s["teamId"], s["leagueId"])] += 1

    merged, seen = [], {}
    dup = 0
    for t in teams:
        key = t["id"]
        if key not in seen:
            seen[key] = t
            merged.append(t)
            continue
        dup += 1
        keep = seen[key]
        # keep whichever row names the league the club plays most of its seasons in
        if league_seasons[(key, t["leagueId"])] > league_seasons[(key, keep["leagueId"])]:
            keep["leagueId"] = t["leagueId"]
        for k, v in t.items():
            if not keep.get(k) and v:
                keep[k] = v
    teams = merged

    # 3. missing teams referenced by seasons
    known = {t["id"] for t in teams}
    missing = defaultdict(lambda: Counter())
    for p in players:
        for s in p["seasons"]:
            if s["teamId"] not in known:
                missing[s["teamId"]][s["leagueId"]] += 1

    added = []
    for team_id, leagues in missing.items():
        league_id = leagues.most_common(1)[0][0]
        raw = re.sub(r"^t-[a-z0-9]+-", "", team_id)
        name = " ".join(w.capitalize() for w in raw.split("-"))
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        league_prefix = team_id.split("-")[1] if team_id.count("-") > 1 else "club"
        added.append({
            "id": team_id,
            "name": name,
            "shortName": name,
            "slug": f"{league_prefix}-{slug}",
            "leagueId": league_id,
            "conference": None,
            "colors": ["#4a5568", "#e2e8f0"],
        })

    for t in added:
        if not any(x["slug"] == t["slug"] for x in teams):
            teams.append(t)

    # 4. two people with one name on the same club in the same season were merged by
    #    mistake; the extra rows become their own profile again
    split = 0
    clones = []
    for p in players:
        seen = Counter((s["season"], s["teamId"]) for s in p["seasons"])
        dup_keys = {k for k, n in seen.items() if n > 1}
        if not dup_keys:
            continue
        keep, moved = [], []
        used = set()
        for s in p["seasons"]:
            key = (s["season"], s["teamId"])
            if key in dup_keys and key in used:
                moved.append(s)
            else:
                keep.append(s)
                if key in dup_keys:
                    used.add(key)
        if not moved:
            continue
        p["seasons"] = keep
        clone = dict(p)
        clone["seasons"] = moved
        clone["id"] = f'{p["id"]}-b'
        clone["slug"] = f'{p["slug"]}-b'
        clones.append(clone)
        split += 1
    players.extend(clones)

    # players whose `teamId` points at a team we have just created keep working
    by_id = {t["id"]: t for t in teams}
    retarget = 0
    for p in players:
        if p["teamId"] not in by_id:
            latest = max(p["seasons"], key=lambda s: s["season"])
            p["teamId"] = latest["teamId"]
            p["leagueId"] = latest["leagueId"]
            retarget += 1

    data["teams"] = teams
    data["players"] = players

    games = json.load(open(GAMES))
    gneg = 0
    for rows in games.values():
        for g in rows:
            gneg += clean_numbers(g)

    print(f"clamped {neg} negative season values, {gneg} game-log values")
    print(f"merged {dup} duplicate team rows, added {len(added)} missing teams, "
          f"retargeted {retarget} players, split {split} same-name merges")
    for t in added:
        print(f"  + {t['name']} ({t['leagueId']})")

    if DRY:
        print("dry run — nothing written")
        return
    with open(DATA, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    with open(GAMES, "w") as f:
        json.dump(games, f, separators=(",", ":"))
    print("wrote data.json and games.json")


if __name__ == "__main__":
    main()
