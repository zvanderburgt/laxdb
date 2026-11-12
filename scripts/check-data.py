"""Integrity checks over the published dataset. Prints only problems."""
import json, re, sys
from collections import Counter

D = json.load(open("/opt/data/projects/laxdb/public/data.json"))
games = json.load(open("/opt/data/projects/laxdb/public/games.json"))
players, teams = D["players"], D["teams"]
team_ids = {t["id"] for t in teams}
league_ids = {l["id"] for l in D["leagues"]}

issues = Counter()
examples = {}


def note(kind, detail):
    issues[kind] += 1
    examples.setdefault(kind, detail)


# slugs unique
slugs = Counter(p["slug"] for p in players)
for s, n in slugs.items():
    if n > 1:
        note("duplicate player slug", s)

tslugs = Counter(t["slug"] for t in teams)
for s, n in tslugs.items():
    if n > 1:
        note("duplicate team slug", s)

for p in players:
    if not p["seasons"]:
        note("player with no seasons", p["slug"])
        continue
    if p["teamId"] not in team_ids:
        note("player on unknown team", f'{p["slug"]} -> {p["teamId"]}')
    if p["leagueId"] not in league_ids:
        note("player in unknown league", p["slug"])
    for s in p["seasons"]:
        if s["teamId"] not in team_ids:
            note("season on unknown team", f'{p["slug"]} {s["season"]}')
        if s.get("pts") is not None and (s.get("g") or 0) + (s.get("a") or 0) != s["pts"]:
            # 2-point goals are legal in pro field and box, so pts > g + a there;
            # only the college feeds are expected to be strictly g + a
            if s["leagueId"] in ("ncaa-d1", "mcla"):
                note("pts != g + a", f'{p["slug"]} {s["season"]} {s.get("g")}+{s.get("a")}!={s.get("pts")}')
        for k in ("gp", "g", "a", "pts", "gb", "ct", "to", "sh"):
            v = s.get(k)
            if isinstance(v, (int, float)) and v < 0:
                note(f"negative {k}", f'{p["slug"]} {s["season"]}')
        if (s.get("gp") or 0) < 0:
            note("negative gp", p["slug"])

empty_teams = [t["name"] for t in teams if not any(p["teamId"] == t["id"] for p in players)]
for name in empty_teams:
    note("team with no players", name)

# games: points consistency
for pid, rows in games.items():
    for g in rows:
        if (g.get("g") or 0) + (g.get("a") or 0) < 0:
            note("negative game line", pid)

print(f"players {len(players)} · teams {len(teams)} · game logs {len(games)}")
if not issues:
    print("no integrity problems found")
for kind, n in issues.most_common():
    print(f"  {kind}: {n}  e.g. {examples[kind]}")
