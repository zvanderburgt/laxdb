#!/usr/bin/env python3
"""Why do GameSheet-covered box leagues still have empty bios?

Read-only diagnostic for phase 2. For every player in a GameSheet-covered league who
still lacks a photo or height, look for the GameSheet row that ought to describe them and
sort the failure into buckets:

  exact-name    the name matches exactly and we still missed it -> a matching bug
  variant       "Mike" vs "Michael", "Jr." suffix, hyphen, apostrophe -> fixable by rule
  jersey        same club + season + jersey number, different name -> needs corroboration
  club-miss     name matches a GameSheet row, but the club never matched
  absent        no GameSheet row for that club and season at all -> nothing to do

  python3 scripts/gamesheet-gap.py
  python3 scripts/gamesheet-gap.py --league nf-ojll
"""
from __future__ import annotations

import argparse
import difflib
import importlib.util
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from gamesheet import GameSheet, full_name  # noqa: E402

DATA = os.path.join(ROOT, "public", "data.json")
SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b\.?", re.I)


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("&", " and ").replace("-", " ").replace("'", "")
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def base_name(text: str) -> str:
    return re.sub(r"\s+", " ", SUFFIX.sub(" ", norm(text))).strip()


def load_spec():
    spec = importlib.util.spec_from_file_location("fg", os.path.join(ROOT, "scripts", "fetch-gamesheet.py"))
    module = importlib.util.module_from_spec(spec)
    sys.argv = ["x"]
    spec.loader.exec_module(module)
    return module


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", help="limit to one of our league ids")
    ap.add_argument("--top", type=int, default=8, help="sample rows per bucket")
    args = ap.parse_args()

    fg = load_spec()
    gs = GameSheet()
    with open(DATA) as f:
        data = json.load(f)

    leagues = fg.load_map(gs)
    mapping = fg.match_leagues(leagues, data)
    title_to_league = {t["id"]: t["leagueId"] for t in data["teams"]}
    team_by_id = {t["id"]: t for t in data["teams"]}

    # GameSheet rows per (league, season, club) so a lookup needs no fuzzy search
    rows_at: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for our_league, entries in mapping.items():
        if args.league and our_league != args.league:
            continue
        for entry in entries:
            for season in (entry.get("seasons") or {}).values():
                if season.get("sport") not in (None, "boxla", "fieldla"):
                    continue
                year = fg.season_year(season)
                if not year:
                    continue
                for row in gs.players(season["id"]) or []:
                    for t in row.get("teams") or []:
                        club = (t.get("title") or "").strip()
                        if club:
                            rows_at[(our_league, str(year), norm(club))].append(row)

    buckets = Counter()
    samples = defaultdict(list)
    by_league = defaultdict(Counter)

    for p in data["players"]:
        lid = p["teamId"] and (team_by_id.get(p["teamId"]) or {}).get("leagueId")
        if lid not in mapping or (args.league and lid != args.league):
            continue
        if p.get("photo") and p.get("heightIn"):
            continue
        key_team = None
        for s in p["seasons"]:
            team = team_by_id.get(s["teamId"]) or {}
            if team.get("leagueId") != lid:
                continue
            names = {norm(team.get("name", "")), norm(team.get("shortName", ""))}
            for (l2, year2, club), rows in rows_at.items():
                if l2 != lid or year2 != s["season"]:
                    continue
                if not (names & {club} or {n.replace(" ", "") for n in names} & {club.replace(" ", "")}):
                    continue
                key_team = (lid, s["season"], club)
                break
            if key_team:
                break

        if not key_team:
            buckets["absent"] += 1
            by_league[lid]["absent"] += 1
            continue

        want, want_base = norm(p["name"]), base_name(p["name"])
        # only rows that would actually fill something count: a same-name row with no
        # photo, height, weight, dob or hometown in it is not a matching failure
        need = []
        if not p.get("photo"):
            need.append("photoUrl")
        if not p.get("heightIn"):
            need.append("height")
        if not p.get("weightLb"):
            need.append("weight")
        if not p.get("dob"):
            need.append("birthdate")
        if not (p.get("birthplace") or {}).get("city"):
            need.append("hometown")

        def useful(row: dict) -> bool:
            return any((row.get(k) or "") for k in need)

        rows = [r for r in rows_at[key_team] if useful(r)]
        if not rows:
            buckets["nothing-to-give"] += 1
            by_league[lid]["nothing-to-give"] += 1
            continue
        exact = [r for r in rows if norm(full_name(r)) == want]
        variant = [r for r in rows if base_name(full_name(r)) == want_base]
        jersey = [p.get("jersey") and r for r in rows
                  if p.get("jersey") and str(r.get("jersey") or "").strip() == str(p.get("jersey"))]

        if exact:
            buckets["exact-name"] += 1
            by_league[lid]["exact-name"] += 1
            samples["exact-name"].append((p["name"], full_name(exact[0]), key_team[1], key_team[2]))
        elif variant:
            buckets["variant"] += 1
            by_league[lid]["variant"] += 1
            samples["variant"].append((p["name"], full_name(variant[0]), key_team[1], key_team[2]))
        elif jersey:
            buckets["jersey"] += 1
            by_league[lid]["jersey"] += 1
            samples["jersey"].append((p["name"], full_name(jersey[0]), key_team[1], key_team[2]))
        else:
            near = difflib.get_close_matches(want, [norm(full_name(r)) for r in rows], n=1, cutoff=0.86)
            if near:
                buckets["near"] += 1
                by_league[lid]["near"] += 1
                samples["near"].append((p["name"], near[0], key_team[1], key_team[2]))
            else:
                buckets["absent"] += 1
                by_league[lid]["absent"] += 1

    total = sum(buckets.values())
    print(f"{total} players in GameSheet leagues still missing a photo or height\n")
    for k, v in buckets.most_common():
        print(f"  {k:<12}{v:>6}  {100 * v / total:>5.1f}%")
    print("\nby league")
    for lid, c in sorted(by_league.items(), key=lambda kv: -sum(kv[1].values())):
        detail = " ".join(f"{k}={v}" for k, v in c.most_common())
        print(f"  {lid:<24}{sum(c.values()):>5}   {detail}")
    for k in ("exact-name", "variant", "near", "jersey"):
        if samples[k]:
            print(f"\n{k} samples")
            for s in samples[k][: args.top]:
                print(f"  ours={s[0]!r:<28} gs={s[1]!r:<28} {s[2]} {s[3]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
