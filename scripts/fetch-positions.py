#!/usr/bin/env python3
"""Stamp box positions (Forward / Transition / Defense / Runner) from the caches.

The box feeds we import print every skater as a skater. GameSheet and Digitalshift
publish the real position, and both caches are already on disk from the bio passes, so
this runs offline and costs nothing:

  python3 scripts/fetch-positions.py                 # report, no writes
  python3 scripts/fetch-positions.py --apply
  python3 scripts/fetch-positions.py --only nf-ojbll --apply

Rules (see scripts/positions.py): field leagues are never touched, a position already
held is never replaced, the newest season in the cache wins, and a box skater with no
evidence stays "Runner" — the feeds genuinely do not distinguish.
"""
from __future__ import annotations

import argparse
import glob
import importlib
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import positions  # noqa: E402
from gamesheet import full_name, name_key, norm  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
GS_CACHE = os.path.join(ROOT, "scripts", ".cache", "gs")
DS_CACHE = os.path.join(ROOT, "scripts", ".cache", "ds")

LACROSSE_SPORTS = ("boxla", "field_lacrosse")


def ds_leagues() -> dict[str, str]:
    """league id -> cache file, from the Digitalshift pass that wrote those rows."""
    try:
        mod = importlib.import_module("fetch-digitalshift")
    except Exception:
        return {}
    out = {}
    for lid, site in mod.LEAGUES.items():
        host = site.split("//")[1]
        slug = "".join(c if c.isalnum() else "-" for c in host).strip("-")
        out[lid] = os.path.join(DS_CACHE, f"{slug}.json")
    return out


def season_starts() -> dict[str, tuple[str, str]]:
    """season id -> (start date, sport) — the only ordering GameSheet gives us."""
    out = {}
    for path in glob.glob(os.path.join(GS_CACHE, "season-info-*.json")):
        try:
            with open(path) as f:
                info = json.load(f)
        except Exception:
            continue
        out[str(info.get("id"))] = (info.get("start") or "", info.get("sport") or "")
    return out


def index(data: dict):
    by_name = defaultdict(list)
    for p in data["players"]:
        by_name[name_key(p["name"])].append(p)
    return by_name, {t["id"]: t for t in data["teams"]}


def club_of_row(row: dict) -> tuple[set[str], set[str]]:
    """(club titles, squashed club titles) for one source row."""
    titles = {norm(t.get("title", "")) for t in (row.get("teams") or []) if t.get("title")}
    return titles, {t.replace(" ", "") for t in titles}


def gamesheet_evidence(by_name, team_by_id, starts: dict) -> tuple[dict, dict]:
    found = defaultdict(list)
    stats = defaultdict(int)
    for path in sorted(glob.glob(os.path.join(GS_CACHE, "players-*.json"))):
        sid = os.path.basename(path)[len("players-"):-len(".json")]
        start, sport = starts.get(sid, ("", ""))
        if sport not in LACROSSE_SPORTS:
            continue                       # the cache also holds hockey leagues
        try:
            with open(path) as f:
                rows = json.load(f)
        except Exception:
            continue
        if not isinstance(rows, list):
            continue
        for row in rows:
            candidates = by_name.get(name_key(full_name(row))) or []
            if not candidates:
                continue
            titles, squashed = club_of_row(row)
            picked = None
            for cand in candidates:
                for tid in {cand["teamId"]} | {s["teamId"] for s in cand["seasons"]}:
                    team = team_by_id.get(tid) or {}
                    names = {norm(team.get("shortName", "")), norm(team.get("name", ""))}
                    if names & titles or {n.replace(" ", "") for n in names} & squashed:
                        picked = cand
                        break
                if picked:
                    break
            if picked is None:
                stats["club_miss"] += 1
                continue
            values = [v for v in (row.get("positions") or []) if v]
            if not values:
                # the per-club entry repeats the position when the player-level one is empty
                for team in row.get("teams") or []:
                    key = norm(team.get("title", ""))
                    if key and (key in titles or key.replace(" ", "") in squashed):
                        values = [v for v in (team.get("positions") or []) if v]
                        break
            code = positions.resolve(values)
            if not code:
                stats["no_position"] += 1
                continue
            found[picked["id"]].append((start, code, "gamesheet"))
            stats["rows"] += 1
    return found, dict(stats)


def digitalshift_evidence(by_name, team_by_id, data: dict) -> tuple[dict, dict]:
    found = defaultdict(list)
    stats = defaultdict(int)
    leagues = {l["id"]: l for l in data["leagues"]}
    for lid, path in ds_leagues().items():
        if not os.path.exists(path):
            continue
        try:
            with open(path) as f:
                rows = (json.load(f) or {}).get("players") or []
        except Exception:
            continue
        for row in rows:
            club = norm(row.get("team_name") or row.get("team") or "")
            squashed = club.replace(" ", "")
            code = positions.resolve([row.get("pos")])
            if not code or not club:
                continue
            for cand in by_name.get(name_key(row.get("name", "")), []):
                on_league = [s for s in cand["seasons"]
                             if (team_by_id.get(s["teamId"]) or {}).get("leagueId") == lid]
                if not on_league:
                    continue
                names = set()
                for s in on_league:
                    team = team_by_id.get(s["teamId"]) or {}
                    names |= {norm(team.get("name", "")), norm(team.get("shortName", ""))}
                if not (club in names or {n.replace(" ", "") for n in names} & {squashed}
                        or any(n and n in club for n in names)):
                    continue
                # the roster rows carry no date: they are the clubs' current rosters, so
                # they rank in the dataset's own season
                found[cand["id"]].append((data["meta"].get("season", ""), code, "digitalshift"))
                stats["rows"] += 1
                break
    return found, dict(stats)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", help="one league id, e.g. nf-ojbll")
    args = ap.parse_args()

    with open(DATA) as f:
        data = json.load(f)
    by_name, team_by_id = index(data)
    starts = season_starts()

    found: dict[str, list] = defaultdict(list)
    gs_found, gs_stats = gamesheet_evidence(by_name, team_by_id, starts)
    ds_found, ds_stats = digitalshift_evidence(by_name, team_by_id, data)
    for src in (gs_found, ds_found):
        for pid, rows in src.items():
            found[pid].extend(rows)

    if args.only:
        keep = {p["id"] for p in data["players"] if p["leagueId"] == args.only}
        found = {pid: rows for pid, rows in found.items() if pid in keep}

    stats = positions.stamp(data, found, apply=args.apply)

    # per-league view: what the site will show after the write
    leagues = {l["id"]: l for l in data["leagues"]}
    per = defaultdict(lambda: defaultdict(int))
    for p in data["players"]:
        if (leagues.get(p["leagueId"]) or {}).get("type") != "box":
            continue
        if args.only and p["leagueId"] != args.only:
            continue
        per[leagues[p["leagueId"]]["short"]][p.get("position") or "?"] += 1
    width = max((len(k) for k in per), default=10)
    print(f"{'league':<{width}}  " + "  ".join(f"{c:>5}" for c in ("F", "T", "D", "R", "G")))
    for short in sorted(per, key=lambda s: -sum(per[s].values())):
        row = per[short]
        print(f"{short:<{width}}  " + "  ".join(f"{row.get(c, 0):>5}" for c in ("F", "T", "D", "R", "G")))

    print(f"\nGameSheet: {gs_stats}")
    print(f"Digitalshift: {ds_stats}")
    print(f"{stats}")
    if args.apply:
        with open(DATA, "w") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"wrote {DATA}")
    else:
        print("dry run — pass --apply to write")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
