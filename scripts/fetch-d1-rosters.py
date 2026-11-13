#!/usr/bin/env python3
"""Backfill NCAA D1 bios from archived per-season roster pages.

The main importer reads only the *current* season's roster, which is why D1 coverage
decays backwards: 2026 98%, 2025 67%, 2024 39%, 2023 18%, 2022 3%. Every school keeps
the older pages at the same path, and they carry jersey, position, class year, height,
weight, hometown, last school and a headshot.

  python3 scripts/fetch-d1-rosters.py                    # report, no writes
  python3 scripts/fetch-d1-rosters.py --apply            # write data.json + photos
  python3 scripts/fetch-d1-rosters.py --season 2024      # one season
  python3 scripts/fetch-d1-rosters.py --only princeton --apply
  python3 scripts/fetch-d1-rosters.py --refresh          # ignore the HTML cache

Pages are cached under scripts/.cache/d1, so a re-run costs no requests and the same
command always produces the same result. Only empty fields are written: a value we
already hold is never overwritten by a roster page.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
CACHE = os.path.join(ROOT, "scripts", ".cache", "d1")

DEFAULT_SEASONS = (2022, 2023, 2024, 2025)

# "Sr." on a 2023 roster graduates in 2023; a freshman graduates three years later
CLASS_OFFSET = {
    "fr.": 3, "fr": 3, "r-fr.": 3, "r-fr": 3,
    "so.": 2, "so": 2, "r-so.": 2, "r-so": 2,
    "jr.": 1, "jr": 1, "r-jr.": 1, "r-jr": 1,
    "sr.": 0, "sr": 0, "r-sr.": 0, "r-sr": 0,
    "gr.": 0, "gr": 0, "5th": 0, "5th yr.": 0,
}


def importer():
    spec = importlib.util.spec_from_file_location(
        "laxdb_importer", os.path.join(ROOT, "scripts", "fetch-real-data.py")
    )
    module = importlib.util.module_from_spec(spec)
    sys.argv = ["fetch-real-data.py"]          # keep its flags out of scope
    spec.loader.exec_module(module)
    return module


def url_variants(site: str, season: int) -> list[str]:
    """Sidearm sites mostly use /roster/<year>; a few want the academic span."""
    tail = str(season + 1)[-2:]
    return [
        f"https://{site}/sports/mens-lacrosse/roster/{season}",
        f"https://{site}/sports/mens-lacrosse/roster/{season}-{tail}",
        f"https://{site}/sports/mlax/roster/{season}",
    ]


def page(imp, site: str, season: int, refresh: bool) -> str | None:
    stem = os.path.join(CACHE, f"{re.sub(r'[^a-z0-9]+', '-', site)}-{season}")
    if os.path.exists(stem + ".html") and not refresh:
        with open(stem + ".html") as f:
            return f.read()
    # a school that has no archived page is remembered, so the next run spends nothing on
    # it instead of re-trying three URL shapes every time
    if os.path.exists(stem + ".miss") and not refresh:
        return None
    for url in url_variants(site, season):
        try:
            html = imp.get(url)
        except Exception:  # noqa: BLE001
            continue
        if html and len(html) > 20_000:
            os.makedirs(CACHE, exist_ok=True)
            with open(stem + ".html", "w") as f:
                f.write(html)
            return html
    os.makedirs(CACHE, exist_ok=True)
    with open(stem + ".miss", "w") as f:
        f.write("\n".join(url_variants(site, season)))
    return None


def class_year(raw: str, season: int) -> int | None:
    offset = CLASS_OFFSET.get((raw or "").strip().lower())
    return season + offset if offset is not None else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--season", type=int, action="append", help="limit to a season (repeatable)")
    ap.add_argument("--only", help="limit to one school slug or domain")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--no-photos", action="store_true")
    args = ap.parse_args()

    imp = importer()
    seasons = tuple(args.season) if args.season else DEFAULT_SEASONS
    with open(DATA) as f:
        data = json.load(f)

    schools = [(name, site) for name, site, *_ in imp.SCHOOLS]
    if args.only:
        needle = args.only.lower()
        schools = [s for s in schools if needle in s[0].lower() or needle in s[1].lower()]

    # name -> players, and (teamId, season) -> set of player ids, so a merged career still
    # resolves to the right roster year
    by_name: dict[str, list[dict]] = {}
    for p in data["players"]:
        by_name.setdefault(imp.norm_name(p["name"]), []).append(p)
    on_team: dict[tuple[str, str], set[str]] = {}
    for p in data["players"]:
        for s in p["seasons"]:
            on_team.setdefault((s["teamId"], s["season"]), set()).add(p["id"])

    filled = {k: 0 for k in ("heightIn", "weightLb", "jersey", "birthplace", "highSchool",
                             "classYear", "photo")}
    pages = matched = 0
    for name, site in schools:
        team_id = f"t-{imp.slugify(name)}"
        for season in seasons:
            html = page(imp, site, season, args.refresh)
            if not html:
                continue
            pages += 1
            roster = imp.parse_roster_page(html)
            photos = imp.parse_roster_photos(html)
            if not roster:
                continue
            here = on_team.get((team_id, str(season)), set())
            hits = 0
            for key, bio in roster.items():
                for player in by_name.get(key, []):
                    if player["id"] not in here:
                        continue
                    hits += 1
                    matched += 1
                    if (bio.get("heightIn") or 0) > 0 and not player.get("heightIn"):
                        player["heightIn"] = bio["heightIn"]
                        filled["heightIn"] += 1
                    if (bio.get("weightLb") or 0) > 0 and not player.get("weightLb"):
                        player["weightLb"] = bio["weightLb"]
                        filled["weightLb"] += 1
                    if (bio.get("jersey") or 0) > 0 and not player.get("jersey"):
                        player["jersey"] = bio["jersey"]
                        filled["jersey"] += 1
                    if bio.get("city") and not (player.get("birthplace") or {}).get("city"):
                        bp = dict(player.get("birthplace") or {"city": "", "state": "", "country": ""})
                        bp["city"] = bio["city"]
                        bp["state"] = bp.get("state") or bio.get("state", "")
                        bp["country"] = bp.get("country") or "USA"
                        player["birthplace"] = bp
                        filled["birthplace"] += 1
                    if bio.get("hs") and not player.get("highSchool"):
                        player["highSchool"] = bio["hs"]
                        filled["highSchool"] += 1
                    cy = class_year(bio.get("rawYear", ""), season)
                    if cy and not player.get("classYear"):
                        player["classYear"] = cy
                        filled["classYear"] += 1

                    url = photos.get(key)
                    if url and not player.get("photo") and not args.no_photos and args.apply:
                        fname = re.sub(r"[^a-z0-9-]", "", player["id"].lower())
                        if imp.grab(url, f"players/ncaa/{fname}.webp", (224, 224)):
                            player["photo"] = f"players/ncaa/{fname}.webp"
                            filled["photo"] += 1
            if hits == 0:
                # almost always a soft 404: the host serves the current roster for a year it
                # never had (Iona's programme began in 2025, so 2022-2024 pages list 2025
                # players). Worth saying out loud so it is not read as a parser failure.
                have = on_team.get((team_id, str(season)))
                why = "we hold no players for that club-season" if not have else "names did not match"
                print(f"  ? {name} {season}: page parsed {len(roster)} players, none matched ({why})")

    print(f"\n{pages} roster pages · {matched} player-seasons matched")
    print("  " + " · ".join(f"{k} +{v}" for k, v in filled.items() if v))
    if not args.apply:
        print("  dry run — pass --apply to write")
        return 0
    with open(DATA, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"  wrote {DATA}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
